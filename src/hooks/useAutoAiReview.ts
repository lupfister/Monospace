import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalDocument } from '../lib/localDocuments';
import { fullReview } from '../lib/openaiAgentApi';
import { extractDocumentContext } from '../lib/contextExtractor';
import { orderedSearchResultsToItems } from '../lib/searchResultItems';
import { buildSearchResultsBlock } from '../lib/searchRenderers';
import { isProbablyUrl } from '../lib/linkPreviews';

const AUTO_REVIEW_MODEL = 'gpt-5-mini';
const AUTO_REVIEW_DEBOUNCE_MS = 300;
const AUTO_REVIEW_MIN_CHARS = 120;
const AUTO_REVIEW_DELAY_MS = 0;
const AUTO_REVIEW_MAX_CHARS = 8000;
const AUTO_REVIEW_ERROR_COOLDOWN_MS = 2 * 60 * 1000;

const OPEN_DOC_HEARTBEAT_MS = 5000;
const OPEN_DOC_TTL_MS = 15_000;
const OPEN_DOCS_KEY = 'monospace.openDocs.v1';

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
    if (ts && ts > latestAiOutputAt) {
      latestAiOutputAt = ts;
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

  return {
    text,
    latestUpdatedAt: latestUpdatedAt || undefined,
    latestAiOutputAt: latestAiOutputAt || undefined,
  };
};


const clampReviewText = (text: string) => {
  if (text.length <= AUTO_REVIEW_MAX_CHARS) return text;
  return text.slice(-AUTO_REVIEW_MAX_CHARS);
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

const isDocOpenElsewhere = (docId: string, tabId: string) => {
  const now = Date.now();
  const entries = pruneOpenDocs(readOpenDocs(), now);
  return entries.some((entry) => entry.docId === docId && entry.tabId !== tabId);
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
  now: number,
  tabId: string,
  activeDocId: string | null,
) => {
  if (doc.id === activeDocId) return false;
  if (!humanText) return false;
  if (humanText.length < AUTO_REVIEW_MIN_CHARS) return false;
  if (isProbablyUrl(humanText.trim())) return false;
  if (isDocOpenElsewhere(doc.id, tabId)) return false;

  const lastHuman = lastHumanUpdatedAt
    ?? parseTimestamp(doc.updatedAt)
    ?? now;

  const lastAi = Math.max(
    lastAiOutputAt ?? 0,
    parseTimestamp(doc.aiReviewedAt) ?? 0
  );

  if (lastAi > 0 && lastHuman <= lastAi) return false;

  if (now - lastHuman < AUTO_REVIEW_DELAY_MS) return false;

  const lastAttempt = parseTimestamp(doc.aiReviewedAt) ?? parseTimestamp(doc.aiReviewAttemptedAt);
  if (lastAttempt && lastAttempt >= lastHuman) return false;

  return true;
};

export const useAutoAiReview = (
  documents: LocalDocument[],
  activeDocId: string | null,
  onReviewUpdate: (docId: string, updates: Partial<LocalDocument>) => void,
) => {
  const [reviewingIds, setReviewingIds] = useState<Record<string, boolean>>({});
  const [homeTrigger, setHomeTrigger] = useState(0);
  const tabId = useMemo(() => getTabId(), []);
  const documentsRef = useRef(documents);
  const activeDocIdRef = useRef(activeDocId);
  const onReviewUpdateRef = useRef(onReviewUpdate);
  const isRunningRef = useRef(false);
  const errorCooldownRef = useRef<Record<string, number>>({});
  const hasRunOnHomeRef = useRef(false);
  const homeRunTimeoutRef = useRef<number | null>(null);
  const lastHomeTriggerRef = useRef(homeTrigger);

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

    const findCandidate = () => {
      const now = Date.now();
      const activeId = activeDocIdRef.current;

      const candidates = documentsRef.current
        .map((doc) => {
          const { text, latestUpdatedAt, latestAiOutputAt } = getHumanContentInfo(doc.content);
          return { doc, text, latestUpdatedAt, latestAiOutputAt };
        })
        .filter(({ doc, text, latestUpdatedAt, latestAiOutputAt }) =>
          shouldReviewContent(doc, text, latestUpdatedAt, latestAiOutputAt, now, tabId, activeId)
        )
        .filter(({ doc }) => {
          const cooldownUntil = errorCooldownRef.current[doc.id];
          return !cooldownUntil || now - cooldownUntil > AUTO_REVIEW_ERROR_COOLDOWN_MS;
        })
        .sort((a, b) => {
          const aTime = a.latestUpdatedAt ?? parseTimestamp(a.doc.updatedAt) ?? 0;
          const bTime = b.latestUpdatedAt ?? parseTimestamp(b.doc.updatedAt) ?? 0;
          return bTime - aTime;
        });

      return candidates[0] ?? null;
    };

    const runReview = async (doc: LocalDocument, humanText: string) => {
      if (cancelled) return;
      if (!acquireReviewLock(doc.id, tabId)) return;

      setReviewingIds((prev) => ({ ...prev, [doc.id]: true }));
      isRunningRef.current = true;

      const startedAt = Date.now();
      const startingUpdatedAt = doc.updatedAt;

      try {
        const container = document.createElement('div');
        container.innerHTML = doc.content || '';

        const context = extractDocumentContext(container);
        const reviewText = clampReviewText(humanText);

        const result = await fullReview(reviewText, AUTO_REVIEW_MODEL, undefined, context);

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

        if (cancelled) return;
        if (isDocOpenAnywhere(doc.id, tabId, activeDocIdRef.current)) return;

        const latestDoc = documentsRef.current.find((item) => item.id === doc.id);
        if (!latestDoc || latestDoc.updatedAt !== startingUpdatedAt) {
          return;
        }

        const resultItems = orderedSearchResultsToItems(searchResults);
        const resultsBlock = await buildSearchResultsBlock(resultItems, narrative);
        container.appendChild(resultsBlock);

        const nextContent = container.innerHTML;

        onReviewUpdateRef.current(doc.id, {
          content: nextContent,
          aiReviewedAt: new Date().toISOString(),
          aiReviewAttemptedAt: new Date().toISOString(),
        });
      } finally {
        releaseReviewLock(doc.id, tabId);
        isRunningRef.current = false;
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
      if (isRunningRef.current) return;
      if (activeDocIdRef.current !== null) return;
      if (hasRunOnHomeRef.current) return;

      const candidate = findCandidate();
      hasRunOnHomeRef.current = true;
      if (!candidate) return;

      await runReview(candidate.doc, candidate.text);
    };

    const scheduleHomeRun = () => {
      if (homeRunTimeoutRef.current) {
        window.clearTimeout(homeRunTimeoutRef.current);
        homeRunTimeoutRef.current = null;
      }
      homeRunTimeoutRef.current = window.setTimeout(() => {
        void tick();
      }, AUTO_REVIEW_DEBOUNCE_MS);
    };

    if (homeTrigger !== lastHomeTriggerRef.current) {
      lastHomeTriggerRef.current = homeTrigger;
      hasRunOnHomeRef.current = false;
    }

    if (activeDocId === null) {
      scheduleHomeRun();
    } else {
      hasRunOnHomeRef.current = false;
    }

    return () => {
      cancelled = true;
      if (homeRunTimeoutRef.current) {
        window.clearTimeout(homeRunTimeoutRef.current);
        homeRunTimeoutRef.current = null;
      }
    };
  }, [activeDocId, tabId, homeTrigger]);

  const requestHomeReviewCheck = useCallback(() => {
    setHomeTrigger((prev) => prev + 1);
  }, []);

  return {
    reviewingIds,
    requestHomeReviewCheck,
  };
};
