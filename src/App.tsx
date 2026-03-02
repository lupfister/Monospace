import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { DocumentEditor } from './components/DocumentEditor';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './components/ui/context-menu';
import { useLocalDocuments } from './hooks/useLocalDocuments';
import { useAutoAiReview } from './hooks/useAutoAiReview';
import { createLocalDocument, type LocalDocument } from './lib/localDocuments';
import { AI_TEXT_STYLE } from './lib/textStyles';

const AI_NODE_SELECTOR =
  '[data-ai-output="true"], [data-ai-text="true"], [data-ai-origin="true"], [data-ai-output-toggle="true"]';
const PRIMARY_BLOCK_TAGS = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();
const deriveTitleFromContent = (content: string) => {
  const text = normalizeWhitespace(content.replace(/<[^>]*>/g, ' '));
  return text ? text.slice(0, 64) : 'Untitled';
};

const stripAiNodesPreserveHuman = (root: HTMLElement) => {
  const aiElements = Array.from(root.querySelectorAll<HTMLElement>(AI_NODE_SELECTOR));
  const extractAllowedContent = (node: Node, fragment: DocumentFragment) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.getAttribute('data-human-text') === 'true') {
        fragment.appendChild(el.cloneNode(true));
        return;
      }
      el.childNodes.forEach((child) => extractAllowedContent(child, fragment));
    }
  };

  for (let i = aiElements.length - 1; i >= 0; i -= 1) {
    const el = aiElements[i];
    if (!el.parentNode) continue;
    const fragment = document.createDocumentFragment();
    el.childNodes.forEach((child) => extractAllowedContent(child, fragment));
    el.parentNode.replaceChild(fragment, el);
  }
};

const getHumanLinesFromNode = (node: HTMLElement) => {
  const clone = node.cloneNode(true) as HTMLElement;
  stripAiNodesPreserveHuman(clone);
  clone.querySelectorAll('br').forEach((br) => {
    br.replaceWith('\n');
  });
  const raw = clone.textContent || '';
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
};

const getLastHumanBlockLines = (content: string) => {
  if (typeof document === 'undefined') return [];
  if (!content) return [];
  const container = document.createElement('div');
  container.innerHTML = content;

  const humanSpans = Array.from(container.querySelectorAll<HTMLElement>('[data-human-text="true"]'))
    .filter((el) => normalizeWhitespace(el.textContent || ''));
  let target: HTMLElement | null = null;

  if (humanSpans.length > 0) {
    const lastSpan = humanSpans[humanSpans.length - 1];
    let cursor = lastSpan.parentElement;
    while (cursor && cursor !== container) {
      if (PRIMARY_BLOCK_TAGS.has(cursor.tagName)) {
        target = cursor;
        break;
      }
      cursor = cursor.parentElement;
    }
    if (!target) {
      cursor = lastSpan.parentElement;
      while (cursor && cursor !== container) {
        if (cursor.tagName === 'DIV') {
          target = cursor;
          break;
        }
        cursor = cursor.parentElement;
      }
    }
  }

  if (!target) {
    const candidates = Array.from(
      container.querySelectorAll<HTMLElement>('p, li, h1, h2, h3, h4, h5, h6, blockquote, div')
    ).filter((el) => el !== container && normalizeWhitespace(el.textContent || ''));
    if (candidates.length > 0) target = candidates[candidates.length - 1];
  }

  if (!target) return [];
  if (target.tagName === 'DIV') {
    const scopedBlocks = Array.from(
      target.querySelectorAll<HTMLElement>('p, li, h1, h2, h3, h4, h5, h6, blockquote')
    ).filter((el) => el.querySelector('[data-human-text="true"]'));
    if (scopedBlocks.length > 0) {
      target = scopedBlocks[scopedBlocks.length - 1];
    }
  }
  return getHumanLinesFromNode(target);
};

const getLastHumanParagraphText = (content: string) => {
  const lines = getLastHumanBlockLines(content);
  if (!lines.length) return '';
  const paragraph = normalizeWhitespace(lines.join(' '));
  return paragraph;
};

const getFallbackExcerpt = (doc: LocalDocument) => {
  if (!doc.content) return doc.title || 'Untitled';
  const candidate = getLastHumanParagraphText(doc.content);
  if (!candidate) return doc.title || 'Untitled';
  return candidate;
};

const extractRevisitExcerpt = (doc: LocalDocument) => {
  if (typeof document === 'undefined') {
    return doc.title || 'Untitled';
  }
  return getFallbackExcerpt(doc);
};

export default function App() {
  const { documents, insertDocument, updateDocument, deleteDocument } = useLocalDocuments();
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [draftDocument, setDraftDocument] = useState<LocalDocument>(() => createLocalDocument());
  const draftInsertedRef = useRef(false);
  const initialDocIdRef = useRef<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [disableRevisitAnimation, setDisableRevisitAnimation] = useState(false);
  const transitionTimeoutRef = useRef<number | null>(null);
  const { reviewingIds, requestHomeReviewCheck } = useAutoAiReview(documents, activeDocId, updateDocument);

  const activeDocument = useMemo(
    () => documents.find((doc) => doc.id === activeDocId) ?? null,
    [documents, activeDocId]
  );

  const handleSaveDocument = (docId: string, content: string, title: string) => {
    if (!documents.some((doc) => doc.id === docId)) return;
    updateDocument(docId, {
      content,
      title,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleAiReviewUpdate = useCallback(
    (
      docId: string,
      update: Partial<Pick<LocalDocument, 'aiReviewedAt' | 'aiExcerpt' | 'aiExcerptUpdatedAt' | 'aiReviewAttemptedAt'>>
    ) => {
      if (!documents.some((doc) => doc.id === docId)) return;
      updateDocument(docId, update);
    },
    [documents, updateDocument]
  );

  const handleDuplicateDocument = useCallback(
    (doc: LocalDocument) => {
      const titleBase = doc.title?.trim() || 'Untitled';
      const duplicate = {
        ...createLocalDocument(doc.content),
        title: `${titleBase} (Copy)`,
        aiReviewedAt: doc.aiReviewedAt,
        aiExcerpt: doc.aiExcerpt,
        aiExcerptUpdatedAt: doc.aiExcerpt ? new Date().toISOString() : undefined,
      };
      insertDocument(duplicate);
    },
    [insertDocument]
  );

  const handleDeleteDocument = useCallback(
    (docId: string) => {
      if (!documents.some((doc) => doc.id === docId)) return;
      deleteDocument(docId);
      if (activeDocId === docId) {
        setActiveDocId(null);
      }
    },
    [activeDocId, deleteDocument, documents]
  );

  const handleOpenInNewTab = useCallback((docId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('doc', docId);
    window.open(url.toString(), '_blank', 'noopener');
  }, []);

  useEffect(() => {
    if (initialDocIdRef.current === null) {
      const params = new URLSearchParams(window.location.search);
      initialDocIdRef.current = params.get('doc');
    }
  }, []);

  useEffect(() => {
    if (activeDocId !== null) return;
    draftInsertedRef.current = false;
    setDraftDocument(createLocalDocument());
    setIsTransitioning(false);
    setDisableRevisitAnimation(false);
    if (transitionTimeoutRef.current) {
      window.clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
  }, [activeDocId]);

  useEffect(() => {
    if (activeDocId === null && initialDocIdRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (activeDocId) {
      params.set('doc', activeDocId);
    } else {
      params.delete('doc');
    }
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
    window.history.replaceState(null, '', nextUrl);
  }, [activeDocId]);

  useEffect(() => {
    if (!initialDocIdRef.current || activeDocId !== null) return;
    const matched = documents.find((doc) => doc.id === initialDocIdRef.current);
    if (matched) {
      initialDocIdRef.current = null;
      setActiveDocId(matched.id);
      return;
    }
    if (documents.length > 0) {
      initialDocIdRef.current = null;
      const params = new URLSearchParams(window.location.search);
      params.delete('doc');
      const nextUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
      window.history.replaceState(null, '', nextUrl);
    }
  }, [activeDocId, documents]);

  const formatDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const prioritizedDocuments = useMemo(() => {
    return documents
      .filter((doc) => doc.aiReviewedAt)
      .sort((a, b) => {
        const aTime = a.aiReviewedAt ? new Date(a.aiReviewedAt).getTime() : 0;
        const bTime = b.aiReviewedAt ? new Date(b.aiReviewedAt).getTime() : 0;
        return bTime - aTime;
      });
  }, [documents]);

  const regularDocuments = useMemo(() => {
    return documents
      .filter((doc) => !doc.aiReviewedAt)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [documents]);

  const [revisitSnapshot, setRevisitSnapshot] = useState<{
    prioritized: LocalDocument[];
    regular: LocalDocument[];
  }>({ prioritized: [], regular: [] });

  const clearDocQueryParam = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('doc')) return;
    params.delete('doc');
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
    window.history.replaceState(null, '', nextUrl);
  }, []);

  useEffect(() => {
    if (!isTransitioning) {
      setRevisitSnapshot({ prioritized: prioritizedDocuments, regular: regularDocuments });
    }
  }, [isTransitioning, prioritizedDocuments, regularDocuments]);

  const handleHeaderHomeClick = useCallback(() => {
    initialDocIdRef.current = null;
    clearDocQueryParam();
    setActiveDocId(null);
    setDisableRevisitAnimation(false);
    requestHomeReviewCheck();
  }, [clearDocQueryParam, requestHomeReviewCheck]);

  const handleOpenRevisitDoc = useCallback((docId: string) => {
    setDisableRevisitAnimation(true);
    setActiveDocId(docId);
  }, []);

  const handleFirstInput = useCallback(
    (content: string) => {
      if (activeDocId !== null) return;
      if (draftInsertedRef.current) return;
      setRevisitSnapshot({ prioritized: prioritizedDocuments, regular: regularDocuments });
      draftInsertedRef.current = true;
      const now = new Date().toISOString();
      const initialContent = content || '';
      const nextDraft = {
        ...draftDocument,
        content: initialContent,
        title: initialContent ? deriveTitleFromContent(initialContent) : draftDocument.title,
        updatedAt: now,
      };
      setDraftDocument(nextDraft);
      insertDocument(nextDraft);
      setActiveDocId(nextDraft.id);
      setIsTransitioning(true);
      if (transitionTimeoutRef.current) {
        window.clearTimeout(transitionTimeoutRef.current);
      }
      transitionTimeoutRef.current = window.setTimeout(() => {
        setIsTransitioning(false);
      }, 240);
    },
    [activeDocId, draftDocument, insertDocument, prioritizedDocuments, regularDocuments]
  );

  const handleDraftEmpty = useCallback(() => {
    if (!draftInsertedRef.current) return;
    const draftId = draftDocument.id;
    if (documents.some((doc) => doc.id === draftId)) {
      deleteDocument(draftId);
    }
    setIsTransitioning(false);
    if (transitionTimeoutRef.current) {
      window.clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
    draftInsertedRef.current = false;
    setDraftDocument(createLocalDocument());
    setActiveDocId(null);
  }, [deleteDocument, documents, draftDocument.id]);

  const currentDoc = activeDocument ?? draftDocument;
  const getRevisitExcerpt = useCallback((doc: LocalDocument) => extractRevisitExcerpt(doc), []);
  const hasRevisitItems = prioritizedDocuments.length > 0 || regularDocuments.length > 0;
  const displayPrioritized = isTransitioning ? revisitSnapshot.prioritized : prioritizedDocuments;
  const displayRegular = isTransitioning ? revisitSnapshot.regular : regularDocuments;
  const displayHasRevisitItems = displayPrioritized.length + displayRegular.length > 0;
  const showRevisit = (activeDocId === null || isTransitioning) && hasRevisitItems;
  const editorMinHeightClass = showRevisit ? 'min-h-[200px]' : 'min-h-screen';
  const isDraftActive = draftInsertedRef.current && currentDoc.id === draftDocument.id;
  const revisitVisible = activeDocId === null;
  const revisitTransitionClass = disableRevisitAnimation ? '' : 'transition-[opacity,filter] duration-300';
  const revisitHiddenClass = disableRevisitAnimation ? 'opacity-0 blur-0' : 'opacity-0 blur-[2px]';
  const aiListTextStyle = {
    color: AI_TEXT_STYLE.color,
    fontFamily: AI_TEXT_STYLE.fontFamily,
    fontSize: AI_TEXT_STYLE.fontSize,
    fontWeight: AI_TEXT_STYLE.fontWeight,
    fontVariationSettings: AI_TEXT_STYLE.fontVariationSettings,
  };

  return (
    <>
      <div className="bg-white min-h-screen relative">
        <DocumentEditor
          key={currentDoc.id}
          doc={currentDoc}
          onSave={handleSaveDocument}
          onAiReview={handleAiReviewUpdate}
          onFirstInput={handleFirstInput}
          isDraftActive={isDraftActive}
          onDraftEmpty={handleDraftEmpty}
          placeholder={activeDocId === null ? 'Start typing to create a new document...' : undefined}
          placeholderMode={activeDocId === null ? 'overlay' : 'inline'}
          editorMinHeightClass={editorMinHeightClass}
          showHeader
          onHeaderHomeClick={handleHeaderHomeClick}
          autoFocus={activeDocId === null}
        />

        {displayHasRevisitItems && (
          <div
            className={`fixed inset-x-0 top-48 z-20 ${revisitVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}
          >
            <div
              className={`${revisitTransitionClass} ${
                revisitVisible ? 'opacity-100 blur-0' : revisitHiddenClass
              }`}
            >
              <div className="max-w-3xl mx-auto px-8">
                <div className="text-sm text-[#807F7F]" style={aiListTextStyle}>
                  Revisit your thoughts...
                </div>

                <div className="flex flex-col">
                {displayPrioritized.map((doc, index) => {
                  const isLast = index === displayPrioritized.length + displayRegular.length - 1;
                  return (
                    <ContextMenu key={doc.id}>
                      <ContextMenuTrigger asChild>
                        <button
                          type="button"
                          onClick={() => handleOpenRevisitDoc(doc.id)}
                          className={`group w-full text-left py-6 cursor-pointer ${
                            isLast ? '' : 'border-b border-[#EDEDED]'
                          }`}
                        >
                          <div className="w-full scale-100 transition-transform duration-200 ease-out transform-gpu will-change-transform group-hover:scale-[1.005]">
                            <div
                              className="text-[18px] leading-[22px] text-black font-medium"
                              style={{ fontFamily: 'EB Garamond, serif' }}
                            >
                              {getRevisitExcerpt(doc)}
                            </div>
                            <div
                              className="mt-2 flex items-start gap-4 text-sm text-[#807F7F]"
                              style={aiListTextStyle}
                            >
                              <div className="flex-1">{doc.title || 'Untitled'}</div>
                              <div className="shrink-0 flex items-center gap-2">
                                {reviewingIds[doc.id] ? (
                                  <Loader2
                                    className="h-4 w-4 animate-spin text-[#bcbcbc]"
                                    aria-label="AI reviewing"
                                  />
                                ) : null}
                                <div>{formatDate(doc.aiReviewedAt || doc.updatedAt)}</div>
                              </div>
                            </div>
                          </div>
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onSelect={() => handleOpenInNewTab(doc.id)}>
                          Open in new tab
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => handleDuplicateDocument(doc)}>
                          Duplicate document
                        </ContextMenuItem>
                        <ContextMenuItem
                          variant="destructive"
                          onSelect={() => handleDeleteDocument(doc.id)}
                        >
                          Delete document
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}

                {displayRegular.map((doc, index) => {
                  const isLast =
                    displayPrioritized.length + index ===
                    displayPrioritized.length + displayRegular.length - 1;
                  return (
                    <ContextMenu key={doc.id}>
                      <ContextMenuTrigger asChild>
                        <button
                          type="button"
                          onClick={() => handleOpenRevisitDoc(doc.id)}
                          className={`group w-full text-left py-6 cursor-pointer ${
                            isLast ? '' : 'border-b border-[#EDEDED]'
                          }`}
                        >
                          <div
                            className="w-full flex items-center gap-4 scale-100 transition-transform duration-200 ease-out transform-gpu will-change-transform group-hover:scale-[1.005]"
                            style={aiListTextStyle}
                          >
                            <div className="flex-1 text-sm text-[#807F7F]">
                              {doc.title || 'Untitled'}
                            </div>
                            <div className="text-sm text-[#807F7F] shrink-0 flex items-center gap-2">
                              {reviewingIds[doc.id] ? (
                                <Loader2
                                  className="h-4 w-4 animate-spin text-[#bcbcbc]"
                                  aria-label="AI reviewing"
                                />
                              ) : null}
                              <div>{formatDate(doc.updatedAt)}</div>
                            </div>
                          </div>
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onSelect={() => handleOpenInNewTab(doc.id)}>
                          Open in new tab
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => handleDuplicateDocument(doc)}>
                          Duplicate document
                        </ContextMenuItem>
                        <ContextMenuItem
                          variant="destructive"
                          onSelect={() => handleDeleteDocument(doc.id)}
                        >
                          Delete document
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <AgentationBoundary>
        <AgentationGate />
      </AgentationBoundary>
    </>
  );
}

type AgentationComponent = () => JSX.Element;

class AgentationBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Agentation crashed:', error);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

function AgentationGate() {
  const [Agentation, setAgentation] = useState<AgentationComponent | null>(null);

  useEffect(() => {
    let isMounted = true;

    if (!import.meta.env.DEV) return undefined;

    import('agentation')
      .then((mod) => {
        if (isMounted) setAgentation(() => mod.Agentation);
      })
      .catch((error) => {
        console.error('Failed to load Agentation:', error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (!Agentation) return null;
  return <Agentation />;
}
