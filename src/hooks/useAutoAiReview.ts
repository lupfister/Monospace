import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalDocument } from '../lib/localDocuments';
import { fullReview } from '../lib/openaiAgentApi';
import { createReviewRequestKey } from '../lib/aiReviewRequestKey';
import { extractDocumentContext } from '../lib/contextExtractor';
import { orderedSearchResultsToItems } from '../lib/searchResultItems';
import { buildSearchResultsBlock } from '../lib/searchRenderers';

const AUTO_REVIEW_MODEL = 'gpt-5-mini';
const AUTO_REVIEW_DEBOUNCE_MS = 300;
const AUTO_REVIEW_DELAY_MS = 0;
const AUTO_REVIEW_MAX_CHARS = 8000;
const AUTO_REVIEW_ERROR_COOLDOWN_MS = 2 * 60 * 1000;
const AUTO_REVIEW_SCAN_INTERVAL_MS = 10_000;
const AUTO_REVIEW_MAX_CONCURRENT_RUNS = 3;

const OPEN_DOC_HEARTBEAT_MS = 5000;
const OPEN_DOC_TTL_MS = 15_000;
const OPEN_DOCS_KEY = 'monospace.openDocs.v1';
const PENDING_AUTO_RESULTS_KEY = 'monospace.pendingAutoResults.v1';
const PENDING_AUTO_RESULTS_TTL_MS = 30 * 60 * 1000;

const REVIEW_LOCK_TTL_MS = 10 * 60 * 1000;
const REVIEW_LOCKS_KEY = 'monospace.aiReviewLocks.v1';
const TAB_ID_KEY = 'monospace.tabId.v1';

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();


const parseTimestamp = (raw?: string | null): number | undefined => {
  if (!raw) return undefined;
  const numeric = Number(raw);
  if (!Number.isNaN(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return parsed;
  return undefined;
};

const stripAiNodes = (root: HTMLElement) => {
  root
    .querySelectorAll(
      '[data-ai-output="true"], [data-ai-text="true"], [data-ai-origin="true"], [data-ai-output-toggle="true"]'
    )
    .forEach((el) => el.remove());
};

const collectHumanBlocks = (container: HTMLElement) => {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>('[data-human-block="true"]'));
  if (blocks.length > 0) return blocks;
  const spans = Array.from(container.querySelectorAll<HTMLElement>('[data-human-text="true"]'));
  return spans;
};

const getHumanContentInfo = (html: string) => {
  const container = document.createElement('div');
  container.innerHTML = html || '';

  let latestUpdatedAt = 0;
  let latestAiOutputAt = 0;
  let latestAiOutputNode: HTMLElement | null = null;
  container.querySelectorAll<HTMLElement>('[data-human-updated-at]').forEach((el) => {
    const ts = parseTimestamp(el.getAttribute('data-human-updated-at'));
    if (ts && ts > latestUpdatedAt) {
      latestUpdatedAt = ts;
    }
  });
  container.querySelectorAll<HTMLElement>('[data-ai-output-generated-at], [data-ai-generated-at]').forEach((el) => {
    const ts = parseTimestamp(
      el.getAttribute('data-ai-output-generated-at') || el.getAttribute('data-ai-generated-at')
    );
    if (ts && ts >= latestAiOutputAt) {
      latestAiOutputAt = ts;
      latestAiOutputNode = el;
    }
  });

  const humanNodes = collectHumanBlocks(container);
  let text = '';
  if (humanNodes.length > 0) {
    text = normalizeWhitespace(
      humanNodes
        .map((node) => normalizeWhitespace(node.textContent || ''))
        .filter(Boolean)
        .join(' ')
    );
  } else {
    stripAiNodes(container);
    text = normalizeWhitespace(container.textContent || '');
  }

  const getNodeHumanUpdatedAt = (node: HTMLElement): number | undefined => {
    let latest = parseTimestamp(node.getAttribute('data-human-updated-at')) ?? 0;
    node.querySelectorAll<HTMLElement>('[data-human-updated-at]').forEach((el) => {
      const ts = parseTimestamp(el.getAttribute('data-human-updated-at'));
      if (ts && ts > latest) latest = ts;
    });
    return latest || undefined;
  };

  const hasHumanEditInsideOrAfterLatestAiOutput = (() => {
    if (!latestAiOutputNode || !latestAiOutputAt) return Boolean(text);

    const humanNodes = Array.from(
      container.querySelectorAll<HTMLElement>('[data-human-text="true"], [data-human-block="true"]')
    );

    return humanNodes.some((node) => {
      const nodeText = normalizeWhitespace(node.textContent || '');
      if (!nodeText) return false;

      const updatedAt = getNodeHumanUpdatedAt(node) ?? 0;
      if (updatedAt <= latestAiOutputAt) return false;

      if (latestAiOutputNode?.contains(node)) return true;

      const relation = latestAiOutputNode.compareDocumentPosition(node);
      return Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING);
    });
  })();

  return {
    text,
    latestUpdatedAt: latestUpdatedAt || undefined,
    latestAiOutputAt: latestAiOutputAt || undefined,
    hasHumanEditInsideOrAfterLatestAiOutput,
  };
};


const clampReviewText = (text: string) => {
  if (text.length <= AUTO_REVIEW_MAX_CHARS) return text;
  return text.slice(-AUTO_REVIEW_MAX_CHARS);
};

const parseAiOutputHtml = (outputHtml: string): HTMLElement | null => {
  if (!outputHtml) return null;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = outputHtml;
  const output = wrapper.querySelector('[data-ai-output="true"]') as HTMLElement | null;
  if (!output) return null;
  output.setAttribute('data-ai-output-collapsed', 'false');
  return output;
};

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
};

const getTabId = () => {
  if (typeof window === 'undefined') return 'server';
  try {
    const existing = sessionStorage.getItem(TAB_ID_KEY);
    if (existing) return existing;
    const next = crypto.randomUUID ? crypto.randomUUID() : `tab_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(TAB_ID_KEY, next);
    return next;
  } catch {
    return `tab_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
};

type OpenDocEntry = {
  docId: string;
  tabId: string;
  lastSeen: number;
};

type ReviewLockEntry = {
  tabId: string;
  startedAt: number;
};

type ReviewLocks = Record<string, ReviewLockEntry>;

type PendingAutoReviewEntry = {
  docId: string;
  baseUpdatedAt: string;
  savedAt: number;
  outputHtml: string;
};

type PendingAutoReviewMap = Record<string, PendingAutoReviewEntry>;

const readOpenDocs = () => readJson<OpenDocEntry[]>(OPEN_DOCS_KEY, []);

const writeOpenDocs = (entries: OpenDocEntry[]) => {
  writeJson(OPEN_DOCS_KEY, entries);
};

const pruneOpenDocs = (entries: OpenDocEntry[], now: number) =>
  entries.filter((entry) => now - entry.lastSeen < OPEN_DOC_TTL_MS);

const readReviewLocks = () => readJson<ReviewLocks>(REVIEW_LOCKS_KEY, {});

const writeReviewLocks = (locks: ReviewLocks) => {
  writeJson(REVIEW_LOCKS_KEY, locks);
};

const readPendingAutoResults = () => readJson<PendingAutoReviewMap>(PENDING_AUTO_RESULTS_KEY, {});

const writePendingAutoResults = (results: PendingAutoReviewMap) => {
  writeJson(PENDING_AUTO_RESULTS_KEY, results);
};

const pruneReviewLocks = (locks: ReviewLocks, now: number): ReviewLocks => {
  const next: ReviewLocks = {};
  Object.entries(locks).forEach(([docId, lock]) => {
    if (now - lock.startedAt < REVIEW_LOCK_TTL_MS) {
      next[docId] = lock;
    }
  });
  return next;
};

const acquireReviewLock = (docId: string, tabId: string): boolean => {
  const now = Date.now();
  const locks = pruneReviewLocks(readReviewLocks(), now);
  const existing = locks[docId];
  if (existing && existing.tabId !== tabId) {
    return false;
  }
  locks[docId] = { tabId, startedAt: now };
  writeReviewLocks(locks);
  return true;
};

const releaseReviewLock = (docId: string, tabId: string) => {
  const locks = pruneReviewLocks(readReviewLocks(), Date.now());
  if (locks[docId]?.tabId === tabId) {
    delete locks[docId];
    writeReviewLocks(locks);
  }
};

const isDocOpenAnywhere = (docId: string, tabId: string, activeDocId: string | null) => {
  const now = Date.now();
  const entries = pruneOpenDocs(readOpenDocs(), now);
  return entries.some((entry) => {
    if (entry.docId !== docId) return false;
    if (entry.tabId !== tabId) return true;
    return activeDocId === docId;
  });
};

// Preflight analysis step to ensure the document has new, meaningful human content before reviewing.
const shouldReviewContent = (
  doc: LocalDocument,
  humanText: string,
  lastHumanUpdatedAt: number | undefined,
  lastAiOutputAt: number | undefined,
  hasHumanEditInsideOrAfterLatestAiOutput: boolean,
  now: number,
  tabId: string,
  activeDocId: string | null,
) => {
  if (!humanText) return false;
  if (isDocOpenAnywhere(doc.id, tabId, activeDocId)) return false;

  const lastHuman = lastHumanUpdatedAt
    ?? parseTimestamp(doc.updatedAt)
    ?? now;

  const lastAi = Math.max(
    lastAiOutputAt ?? 0,
    parseTimestamp(doc.aiReviewedAt) ?? 0
  );

  if (lastAi > 0 && lastHuman <= lastAi) return false;
  if (lastAi > 0 && !hasHumanEditInsideOrAfterLatestAiOutput) return false;

  if (now - lastHuman < AUTO_REVIEW_DELAY_MS) return false;

  const lastAttempt = Math.max(
    parseTimestamp(doc.aiReviewedAt) ?? 0,
    parseTimestamp(doc.aiReviewAttemptedAt) ?? 0
  );
  if (lastAttempt && lastAttempt >= lastHuman) return false;

  return true;
};

export const useAutoAiReview = (
  documents: LocalDocument[],
  activeDocId: string | null,
  onReviewUpdate: (docId: string, updates: Partial<LocalDocument>) => void,
) => {
  const [reviewingIds, setReviewingIds] = useState<Record<string, boolean>>({});
  const [reviewTrigger, setReviewTrigger] = useState(0);
  const tabId = useMemo(() => getTabId(), []);
  const documentsRef = useRef(documents);
  const activeDocIdRef = useRef(activeDocId);
  const onReviewUpdateRef = useRef(onReviewUpdate);
  const inFlightCountRef = useRef(0);
  const runningDocIdsRef = useRef<Set<string>>(new Set());
  const errorCooldownRef = useRef<Record<string, number>>({});
  const scanTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    activeDocIdRef.current = activeDocId;
  }, [activeDocId]);

  useEffect(() => {
    onReviewUpdateRef.current = onReviewUpdate;
  }, [onReviewUpdate]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const syncOpenDoc = (docId: string | null) => {
      const now = Date.now();
      const entries = pruneOpenDocs(readOpenDocs(), now)
        .filter((entry) => entry.tabId !== tabId);

      if (docId) {
        entries.push({ docId, tabId, lastSeen: now });
      }

      writeOpenDocs(entries);
    };

    syncOpenDoc(activeDocIdRef.current);

    const interval = window.setInterval(() => {
      syncOpenDoc(activeDocIdRef.current);
    }, OPEN_DOC_HEARTBEAT_MS);

    const handleVisibility = () => {
      syncOpenDoc(activeDocIdRef.current);
    };

    const handleUnload = () => {
      const now = Date.now();
      const entries = pruneOpenDocs(readOpenDocs(), now)
        .filter((entry) => entry.tabId !== tabId);
      writeOpenDocs(entries);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
      handleUnload();
    };
  }, [tabId]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let cancelled = false;

    const findCandidates = (limit: number, excludeDocIds: Set<string> = new Set()) => {
      const now = Date.now();
      const activeId = activeDocIdRef.current;
      const pending = readPendingAutoResults();

      const candidates = documentsRef.current
        .map((doc) => {
          const { text, latestUpdatedAt, latestAiOutputAt, hasHumanEditInsideOrAfterLatestAiOutput } = getHumanContentInfo(doc.content);
          return { doc, text, latestUpdatedAt, latestAiOutputAt, hasHumanEditInsideOrAfterLatestAiOutput };
        })
        .filter(({ doc, text, latestUpdatedAt, latestAiOutputAt, hasHumanEditInsideOrAfterLatestAiOutput }) =>
          shouldReviewContent(
            doc,
            text,
            latestUpdatedAt,
            latestAiOutputAt,
            hasHumanEditInsideOrAfterLatestAiOutput,
            now,
            tabId,
            activeId
          )
        )
        .filter(({ doc }) => {
          const cooldownUntil = errorCooldownRef.current[doc.id];
          return !cooldownUntil || now - cooldownUntil > AUTO_REVIEW_ERROR_COOLDOWN_MS;
        })
        .filter(({ doc }) => !pending[doc.id])
        .filter(({ doc }) => !excludeDocIds.has(doc.id))
        .sort((a, b) => {
          const aTime = a.latestUpdatedAt ?? parseTimestamp(a.doc.updatedAt) ?? 0;
          const bTime = b.latestUpdatedAt ?? parseTimestamp(b.doc.updatedAt) ?? 0;
          return bTime - aTime;
        });

      return candidates.slice(0, Math.max(0, limit));
    };

    const runReview = async (doc: LocalDocument, humanText: string) => {
      if (cancelled) return;
      if (runningDocIdsRef.current.has(doc.id)) return;
      if (!acquireReviewLock(doc.id, tabId)) return;
      runningDocIdsRef.current.add(doc.id);
      inFlightCountRef.current += 1;

      setReviewingIds((prev) => ({ ...prev, [doc.id]: true }));

      const startedAt = Date.now();
      const startingUpdatedAt = doc.updatedAt;

      const applyReviewOutput = async (
        docId: string,
        baseUpdatedAt: string,
        outputHtml: string,
      ): Promise<'applied' | 'open' | 'stale' | 'missing' | 'cancelled' | 'invalid_output'> => {
        if (cancelled) return 'cancelled';
        if (isDocOpenAnywhere(docId, tabId, activeDocIdRef.current)) return 'open';

        const latestDoc = documentsRef.current.find((item) => item.id === docId);
        if (!latestDoc) return 'missing';
        if (latestDoc.updatedAt !== baseUpdatedAt) return 'stale';

        const container = document.createElement('div');
        container.innerHTML = latestDoc.content || '';

        const previousOutputs = Array.from(container.querySelectorAll<HTMLElement>('[data-ai-output="true"]'));
        previousOutputs.forEach((output) => {
          output.setAttribute('data-ai-output-collapsed', 'true');
        });

        const outputNode = parseAiOutputHtml(outputHtml);
        if (!outputNode) return 'invalid_output';
        container.appendChild(outputNode);

        onReviewUpdateRef.current(docId, {
          content: container.innerHTML,
          aiReviewedAt: new Date().toISOString(),
          aiReviewAttemptedAt: new Date().toISOString(),
        });

        return 'applied';
      };

      try {
        const container = document.createElement('div');
        container.innerHTML = doc.content || '';

        const context = extractDocumentContext(container);
        const reviewText = clampReviewText(humanText);
        const requestKey = createReviewRequestKey({
          docId: doc.id,
          text: reviewText,
          model: AUTO_REVIEW_MODEL,
          context,
          mode: 'auto',
        });

        const result = await fullReview(reviewText, AUTO_REVIEW_MODEL, undefined, context, requestKey);

        if (!result.ok) {
          errorCooldownRef.current[doc.id] = Date.now();
          return;
        }

        const { searchResults, narrative } = result.data;
        if (searchResults.length === 0 && (!narrative || narrative.blocks.length === 0)) {
          onReviewUpdateRef.current(doc.id, { aiReviewAttemptedAt: new Date().toISOString() });
          return;
        }
        delete errorCooldownRef.current[doc.id];

        let outputHtml = '';
        try {
          const resultItems = orderedSearchResultsToItems(searchResults);
          const resultsBlock = await buildSearchResultsBlock(resultItems, narrative);
          outputHtml = resultsBlock.outerHTML;
        } catch (error) {
          console.error('[useAutoAiReview] Failed to build review output:', error);
          errorCooldownRef.current[doc.id] = Date.now();
          onReviewUpdateRef.current(doc.id, { aiReviewAttemptedAt: new Date().toISOString() });
          return;
        }
        if (!outputHtml) {
          errorCooldownRef.current[doc.id] = Date.now();
          onReviewUpdateRef.current(doc.id, { aiReviewAttemptedAt: new Date().toISOString() });
          return;
        }

        const applyOutcome = await applyReviewOutput(
          doc.id,
          startingUpdatedAt,
          outputHtml
        );
        if (applyOutcome === 'open') {
          const pending = readPendingAutoResults();
          pending[doc.id] = {
            docId: doc.id,
            baseUpdatedAt: startingUpdatedAt,
            savedAt: Date.now(),
            outputHtml,
          };
          writePendingAutoResults(pending);
          return;
        }

        if (applyOutcome !== 'applied') {
          if (applyOutcome === 'invalid_output') {
            errorCooldownRef.current[doc.id] = Date.now();
          }
          if (applyOutcome !== 'cancelled') {
            onReviewUpdateRef.current(doc.id, { aiReviewAttemptedAt: new Date().toISOString() });
          }
          const pending = readPendingAutoResults();
          if (pending[doc.id]) {
            delete pending[doc.id];
            writePendingAutoResults(pending);
          }
          return;
        }

        const pending = readPendingAutoResults();
        if (pending[doc.id]) {
          delete pending[doc.id];
          writePendingAutoResults(pending);
        }
      } finally {
        releaseReviewLock(doc.id, tabId);
        runningDocIdsRef.current.delete(doc.id);
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
        setReviewingIds((prev) => {
          const next = { ...prev };
          delete next[doc.id];
          return next;
        });
        if (!cancelled && Date.now() - startedAt < AUTO_REVIEW_DEBOUNCE_MS) {
          // Give the UI a brief moment to update before resolving.
          await new Promise((resolve) => setTimeout(resolve, AUTO_REVIEW_DEBOUNCE_MS));
        }
      }
    };

    const tick = async () => {
      if (cancelled) return;

      const pending = readPendingAutoResults();
      const now = Date.now();
      let pendingMutated = false;
      const pendingEntries = Object.values(pending).sort((a, b) => b.savedAt - a.savedAt);
      let pendingApplied = false;
      for (const entry of pendingEntries) {
        if (now - entry.savedAt > PENDING_AUTO_RESULTS_TTL_MS) {
          delete pending[entry.docId];
          pendingMutated = true;
          continue;
        }

        const latestDoc = documentsRef.current.find((item) => item.id === entry.docId);
        if (!latestDoc) {
          delete pending[entry.docId];
          pendingMutated = true;
          continue;
        }

        if (latestDoc.updatedAt !== entry.baseUpdatedAt) {
          delete pending[entry.docId];
          pendingMutated = true;
          continue;
        }

        if (isDocOpenAnywhere(entry.docId, tabId, activeDocIdRef.current)) {
          continue;
        }

        if (!acquireReviewLock(entry.docId, tabId)) {
          continue;
        }

        try {
          const container = document.createElement('div');
          container.innerHTML = latestDoc.content || '';
          const previousOutputs = Array.from(container.querySelectorAll<HTMLElement>('[data-ai-output="true"]'));
          previousOutputs.forEach((output) => {
            output.setAttribute('data-ai-output-collapsed', 'true');
          });
          const outputNode = parseAiOutputHtml(entry.outputHtml);
          if (!outputNode) {
            delete pending[entry.docId];
            pendingMutated = true;
            writePendingAutoResults(pending);
            continue;
          }
          container.appendChild(outputNode);
          onReviewUpdateRef.current(entry.docId, {
            content: container.innerHTML,
            aiReviewedAt: new Date().toISOString(),
            aiReviewAttemptedAt: new Date().toISOString(),
          });
          delete pending[entry.docId];
          pendingMutated = true;
          pendingApplied = true;
          break;
        } finally {
          releaseReviewLock(entry.docId, tabId);
        }
      }

      if (pendingMutated) {
        writePendingAutoResults(pending);
      }

      if (pendingApplied) return;

      const availableSlots = Math.max(0, AUTO_REVIEW_MAX_CONCURRENT_RUNS - inFlightCountRef.current);
      if (availableSlots <= 0) return;

      const excludeDocIds = new Set<string>(runningDocIdsRef.current);
      const candidates = findCandidates(availableSlots, excludeDocIds);
      if (candidates.length === 0) return;

      candidates.forEach(({ doc, text }) => {
        void runReview(doc, text);
      });
    };

    const scheduleImmediateTick = () => {
      if (scanTimeoutRef.current) {
        window.clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }
      scanTimeoutRef.current = window.setTimeout(() => {
        void tick();
      }, AUTO_REVIEW_DEBOUNCE_MS);
    };

    scheduleImmediateTick();

    const interval = window.setInterval(() => {
      void tick();
    }, AUTO_REVIEW_SCAN_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (scanTimeoutRef.current) {
        window.clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }
    };
  }, [tabId, reviewTrigger]);

  const requestHomeReviewCheck = useCallback(() => {
    setReviewTrigger((prev) => prev + 1);
  }, []);

  return {
    reviewingIds,
    requestHomeReviewCheck,
  };
};
