import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DocumentEditor } from './components/DocumentEditor';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './components/ui/context-menu';
import { useLocalDocuments } from './hooks/useLocalDocuments';
import { createLocalDocument, type LocalDocument } from './lib/localDocuments';
import { AI_TEXT_STYLE } from './lib/textStyles';

const REVISIT_EXCERPT_MAX = 160;

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const extractLastSentence = (text: string) => {
  const sentences = text.match(/[^.!?]+[.!?]+(?:["')\]]+)?/g);
  if (!sentences || sentences.length === 0) return '';
  const normalized = sentences.map((sentence) => normalizeWhitespace(sentence)).filter(Boolean);
  if (normalized.length === 0) return '';
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    if (normalized[i].length >= 20) return normalized[i];
  }
  return normalized[normalized.length - 1];
};

const extractRevisitExcerpt = (doc: LocalDocument) => {
  if (typeof document === 'undefined') {
    return doc.aiExcerpt || doc.title || 'Untitled';
  }
  if (!doc.content) return doc.aiExcerpt || doc.title || 'Untitled';

  const container = document.createElement('div');
  container.innerHTML = doc.content;
  container
    .querySelectorAll(
      '[data-ai-output="true"], [data-ai-text="true"], [data-ai-origin="true"], [data-ai-output-toggle="true"]'
    )
    .forEach((el) => el.remove());

  const blocks = Array.from(container.querySelectorAll('[data-human-block="true"]'));
  const candidates = blocks.length > 0
    ? blocks
    : Array.from(container.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote'));

  const extractReadableTextFromBlock = (block: HTMLElement) => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    let text = '';
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const chunk = (node as Text).data;
      if (!chunk) continue;
      if (!text) {
        text = chunk;
        continue;
      }
      const lastChar = text[text.length - 1] ?? '';
      const firstChar = chunk[0] ?? '';
      const needsSpace = !/\s/.test(lastChar)
        && !/\s/.test(firstChar)
        && /[A-Za-z0-9]/.test(lastChar)
        && /[A-Za-z0-9]/.test(firstChar);
      text = needsSpace ? `${text} ${chunk}` : `${text}${chunk}`;
    }
    const normalized = normalizeWhitespace(text);
    return normalized.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  };

  let text = '';
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    text = extractReadableTextFromBlock(candidates[i] as HTMLElement);
    if (text) break;
  }
  if (!text) return doc.aiExcerpt || doc.title || 'Untitled';

  const lastSentence = extractLastSentence(text);
  const candidate = lastSentence || text;
  if (candidate.length <= REVISIT_EXCERPT_MAX) return candidate;
  return candidate.slice(0, REVISIT_EXCERPT_MAX);
};

export default function App() {
  const { documents, insertDocument, updateDocument, deleteDocument } = useLocalDocuments();
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [draftDocument, setDraftDocument] = useState<LocalDocument>(() => createLocalDocument());
  const draftInsertedRef = useRef(false);
  const initialDocIdRef = useRef<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionTimeoutRef = useRef<number | null>(null);

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
    (docId: string, update: { aiReviewedAt: string; aiExcerpt?: string }) => {
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

  const handleFirstInput = useCallback(
    (_content: string) => {
      if (activeDocId !== null) return;
      if (draftInsertedRef.current) return;
      draftInsertedRef.current = true;
      const now = new Date().toISOString();
      const nextDraft = {
        ...draftDocument,
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
    [activeDocId, draftDocument, insertDocument]
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

  const currentDoc = activeDocument ?? draftDocument;
  const getRevisitExcerpt = useCallback((doc: LocalDocument) => extractRevisitExcerpt(doc), []);
  const hasRevisitItems = prioritizedDocuments.length > 0 || regularDocuments.length > 0;
  const showRevisit = (activeDocId === null || isTransitioning) && hasRevisitItems;
  const editorMinHeightClass = showRevisit ? 'min-h-[200px]' : 'min-h-screen';
  const isDraftActive = draftInsertedRef.current && currentDoc.id === draftDocument.id;
  const aiListTextStyle = {
    color: AI_TEXT_STYLE.color,
    fontFamily: AI_TEXT_STYLE.fontFamily,
    fontSize: AI_TEXT_STYLE.fontSize,
    fontWeight: AI_TEXT_STYLE.fontWeight,
    fontVariationSettings: AI_TEXT_STYLE.fontVariationSettings,
  };

  return (
    <>
      <div className="bg-white min-h-screen">
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
          footer={showRevisit ? (
            <div
              className={`transition-all duration-300 ${
                isTransitioning
                  ? 'opacity-0 blur-[2px] translate-y-1 pointer-events-none'
                  : 'opacity-100 blur-0 translate-y-0'
              }`}
            >
              <div className="text-sm text-[#807F7F]" style={aiListTextStyle}>
                Revisit your thoughts...
              </div>

              <div className="flex flex-col">
                {prioritizedDocuments.map((doc, index) => {
                  const isLast = index === prioritizedDocuments.length + regularDocuments.length - 1;
                  return (
                  <ContextMenu key={doc.id}>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setActiveDocId(doc.id)}
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
                          <div className="shrink-0">
                            {formatDate(doc.aiReviewedAt || doc.updatedAt)}
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

                {regularDocuments.map((doc, index) => {
                  const isLast =
                    prioritizedDocuments.length + index ===
                    prioritizedDocuments.length + regularDocuments.length - 1;
                  return (
                  <ContextMenu key={doc.id}>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setActiveDocId(doc.id)}
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
                          <div className="text-sm text-[#807F7F] shrink-0">
                            {formatDate(doc.updatedAt)}
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
          ) : null}
          autoFocus={activeDocId === null}
        />
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
