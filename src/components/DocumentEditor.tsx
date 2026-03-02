import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MoveHorizontal, Sparkles, Loader2 } from 'lucide-react';
import { AI_TEXT_STYLE, createHumanTextSpan, isHumanTextSpan, isAiTextSpan, rehydrateSourceLinks } from '../lib/textStyles';
import { applyAiHiddenState, clearAiHiddenState, animateAiHide, animateAiShow } from '../lib/aiOutputVisibility';
import { formatAiOutputLabel } from '../lib/aiOutputLabel';

import { useLinkHydrator } from '../hooks/useLinkHydrator';
import { useSearchAgent } from '../hooks/useSearchAgent';
import { MarginTextContainer, MarginTextData } from './MarginTextContainer';
import { OPENAI_MODEL_OPTIONS } from '../lib/openaiAgentApi';
import { generateWithOpenAI } from '../lib/openaiAgentApi';
import { rehydrateInteractiveSources, rehydrateViewedSourcesToggles } from '../lib/searchRenderers';
import { persistViewedSourcesForDoc, persistViewedSourcesForOutput } from '../lib/aiOutputSources';
import type { LocalDocument } from '../lib/localDocuments';

type AiReviewUpdate = {
  aiReviewedAt: string;
};

type DocumentEditorProps = {
  doc: LocalDocument;
  onSave: (docId: string, content: string, title: string) => void;
  onAiReview?: (docId: string, update: AiReviewUpdate) => void;
  onFirstInput?: (content: string) => void;
  isDraftActive?: boolean;
  onDraftEmpty?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  placeholderMode?: 'inline' | 'overlay';
  editorMinHeightClass?: string;
  footer?: React.ReactNode;
  showHeader?: boolean;
  onHeaderHomeClick?: () => void;
};

const HISTORY_STORAGE_PREFIX = 'monospace.history.v1';
const HISTORY_LIMIT = 100;
const HISTORY_SNAPSHOT_DELAY = 300;

const normalizeWhitespace = (value: string) =>
  value.replace(/[\u200B\uFEFF]/g, '').replace(/\s+/g, ' ').trim();


export function DocumentEditor({
  doc,
  onSave,
  onAiReview,
  onFirstInput,
  isDraftActive = false,
  onDraftEmpty,
  autoFocus = false,
  placeholder,
  placeholderMode = 'inline',
  editorMinHeightClass = 'min-h-screen',
  footer,
  showHeader = true,
  onHeaderHomeClick,
}: DocumentEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isEditorEmpty, setIsEditorEmpty] = useState(true);
  const hasUserInputRef = useRef(false);
  const didNotifyEmptyRef = useRef(false);

  const { hydrateSearchResultImages } = useLinkHydrator(editorRef);

  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedContent, setDraggedContent] = useState('');
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [dropCursorPos, setDropCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [dragElementPos, setDragElementPos] = useState<{ x: number; y: number } | null>(null);
  const draggedFragment = useRef<DocumentFragment | null>(null);
  const [marginTexts, setMarginTexts] = useState<MarginTextData[]>([]);
  const [dragTarget, setDragTarget] = useState<'editor' | 'left-margin' | 'right-margin' | null>(null);
  const [marginWidth, setMarginWidth] = useState(256);
  const [marginSide, setMarginSide] = useState<'left' | 'right' | null>(null);
  const [isResizingMargin, setIsResizingMargin] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [additionalSelections, setAdditionalSelections] = useState<Range[]>([]);
  const [isShiftSelecting, setIsShiftSelecting] = useState(false);
  const shiftSelectStart = useRef<{ x: number; y: number } | null>(null);
  const lastKnownRange = useRef<Range | null>(null);

  const [selectedModel, setSelectedModel] = useState('gpt-5-mini');
  const [isTitleGenerating, setIsTitleGenerating] = useState(false);
  const titleGeneratedRef = useRef<Set<string>>(new Set());
  const autosaveTimeoutRef = useRef<number | null>(null);
  const scheduleAutosaveRef = useRef<() => void>(() => { });
  const handleSaveRef = useRef<() => void>(() => { });
  const scheduleEditorEmptyUpdateRef = useRef<() => void>(() => { });
  const historySnapshotTimeoutRef = useRef<number | null>(null);
  const historyStateRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const lastSnapshotRef = useRef('');
  const persistHistoryStateRef = useRef<() => void>(() => { });
  const queueHistorySnapshotRef = useRef<() => void>(() => { });
  const handleUndoRef = useRef<() => void>(() => { });
  const handleRedoRef = useRef<() => void>(() => { });
  const isApplyingHistoryRef = useRef(false);
  const isHydratingRef = useRef(false);
  const initializedHistoryDocIdRef = useRef<string | null>(null);
  const VIEWED_SOURCES_HEADER_SELECTOR = '[data-viewed-sources-header="true"]';

  const placeholderText = placeholder ?? '';
  const hasPlaceholder = Boolean(placeholderText);
  const useOverlayPlaceholder = hasPlaceholder && placeholderMode === 'overlay';
  const editorBackgroundClass = useOverlayPlaceholder ? 'bg-transparent' : 'bg-white';
  const scrollCenterPadding = showHeader ? 'calc(50vh - 24px)' : '50vh';
  const scrollTopPadding = '24px';

  const getAiOutputContainer = (node: Node | null): HTMLElement | null => {
    if (!node) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
    if (!element) return null;
    return element.closest('[data-ai-output="true"]') as HTMLElement | null;
  };

  const getCollapsedAiOutputContainer = (node: Node | null): HTMLElement | null => {
    const container = getAiOutputContainer(node);
    if (!container) return null;
    return container.getAttribute('data-ai-output-collapsed') === 'true' ? container : null;
  };

  const getAiOutputLabelText = (container: HTMLElement, collapsed: boolean) => {
    const generatedAt = container.getAttribute('data-ai-output-generated-at');
    return formatAiOutputLabel(collapsed, generatedAt);
  };

  const isSelectionInCollapsedOutput = (range: Range): boolean => {
    return Boolean(
      getCollapsedAiOutputContainer(range.startContainer) ||
      getCollapsedAiOutputContainer(range.endContainer) ||
      getCollapsedAiOutputContainer(range.commonAncestorContainer)
    );
  };

  const setAiOutputCollapsed = useCallback((container: HTMLElement, collapsed: boolean, animate = true) => {
    const body = container.querySelector('[data-ai-output-body="true"]') as HTMLElement | null;
    if (!body) return;

    if (animate) {
      container.setAttribute('data-ai-output-animating', 'true');
    } else {
      container.removeAttribute('data-ai-output-animating');
    }

    container.setAttribute('data-ai-output-collapsed', collapsed ? 'true' : 'false');

    const finishAnimation = () => {
      container.removeAttribute('data-ai-output-animating');
    };

    const ensureToggleOutsideBody = () => {
      const toggle = container.querySelector('[data-ai-output-toggle="true"]') as HTMLElement | null;
      if (toggle && toggle.parentElement !== container) {
        const spacers = Array.from(container.querySelectorAll('[data-ai-output-spacer="true"]')) as HTMLElement[];
        const insertBeforeNode = spacers.length > 1 ? spacers[1] : body;
        container.insertBefore(toggle, insertBeforeNode);
      }
    };

    const updateLabelAndAria = () => {
      const toggle = container.querySelector('[data-ai-output-toggle="true"]') as HTMLElement | null;
      if (!toggle) return;
      const label = container.querySelector('[data-ai-output-label="true"]') as HTMLElement | null;
      if (label) {
        label.textContent = getAiOutputLabelText(container, collapsed);
      } else {
        const fallbackLabel = document.createElement('span');
        fallbackLabel.dataset.aiOutputLabel = 'true';
        fallbackLabel.dataset.aiUi = 'true';
        fallbackLabel.textContent = getAiOutputLabelText(container, collapsed);
        fallbackLabel.contentEditable = 'false';
        toggle.appendChild(fallbackLabel);
      }
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    };

    // Helper: apply all toggle / header / spacer / label UI changes
    const applyUiChanges = () => {
      const toggle = container.querySelector('[data-ai-output-toggle="true"]') as HTMLElement | null;
      const header = body.querySelector(VIEWED_SOURCES_HEADER_SELECTOR) as HTMLElement | null;

      if (collapsed) {
        if (header) header.style.display = 'none';
        if (toggle) toggle.style.display = 'inline-flex';
      } else {
        if (header) header.style.display = 'inline-flex';
        if (toggle) toggle.style.display = 'inline-flex';
      }

      ensureToggleOutsideBody();
      updateLabelAndAria();
    };

    if (animate) {
      ensureToggleOutsideBody();
      updateLabelAndAria();
      if (collapsed) {
        // HIDE: record toggle position before collapse so we can scroll-anchor it
        const toggleEl = container.querySelector('[data-ai-output-toggle="true"]') as HTMLElement | null;
        const preCollapseToggleTop = toggleEl
          ? toggleEl.getBoundingClientRect().top + window.scrollY
          : null;

        animateAiHide(body, () => {
          applyUiChanges();
          finishAnimation();

          // Scroll-anchor: keep the toggle at the same visual position after content collapses
          if (toggleEl && preCollapseToggleTop !== null) {
            const postToggleTop = toggleEl.getBoundingClientRect().top + window.scrollY;
            const delta = postToggleTop - preCollapseToggleTop;
            if (Math.abs(delta) > 1) {
              window.scrollBy({ top: delta, behavior: 'smooth' });
            }
          }
        });
      } else {
        // SHOW: apply UI changes first; animateAiShow handles clearAiHiddenState
        // internally so it can measure the correct start height before revealing.
        applyUiChanges();
        animateAiShow(body, () => {
          finishAnimation();
          // Scroll to reveal newly expanded content
          body.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
    } else {
      if (collapsed) {
        applyAiHiddenState(body);
      } else {
        clearAiHiddenState(body);
      }
      applyUiChanges();
      finishAnimation();
    }

    const icon = container.querySelector('[data-ai-output-icon="true"]') as HTMLElement | null;
    if (icon) {
      icon.style.transform = 'rotate(0deg)';
      const morphPath = icon.querySelector('[data-ai-output-morph="true"]') as SVGPathElement | null;
      const loopTarget = icon.querySelector('[data-ai-output-loop-target="true"]') as SVGPathElement | null;
      const lineTarget = icon.querySelector('[data-ai-output-line-target="true"]') as SVGPathElement | null;
      if (morphPath && loopTarget && lineTarget) {
        const SAMPLE_COUNT = 36;
        const samplePath = (pathEl: SVGPathElement, samples: number) => {
          const total = pathEl.getTotalLength();
          const points = [];
          for (let i = 0; i < samples; i += 1) {
            const p = pathEl.getPointAtLength((total * i) / (samples - 1));
            points.push({ x: p.x, y: p.y });
          }
          return points;
        };
        const pointsToD = (points: { x: number; y: number }[]) => {
          if (!points.length) return '';
          const [first, ...rest] = points;
          const lines = rest.map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
          return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} ${lines.join(' ')}`;
        };
        const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
        const applyOutwardSpread = (points: { x: number; y: number }[], progress: number) => {
          const spreadProgress = Math.min(1, progress * 1.6);
          const intensity = Math.sin(spreadProgress * Math.PI) * 1.5 * (1 - progress * 0.6);
          return points.map((point) => {
            if (point.y >= 10) {
              const direction = point.x < 8 ? -1 : 1;
              return { x: point.x + direction * intensity, y: point.y };
            }
            return point;
          });
        };
        const animateMorph = (
          fromPath: SVGPathElement,
          toPath: SVGPathElement,
          duration = 220,
          options: { spreadOutward?: boolean } = {},
          onComplete?: () => void
        ) => {
          const existing = (fromPath as SVGPathElement & { _aiMorphRaf?: number })._aiMorphRaf;
          if (existing) {
            cancelAnimationFrame(existing);
          }
          const startPoints = samplePath(fromPath, SAMPLE_COUNT);
          const endPoints = samplePath(toPath, SAMPLE_COUNT);
          const start = performance.now();
          const step = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const e = easeInOut(t);
            let nextPoints = startPoints.map((p, i) => ({
              x: p.x + (endPoints[i].x - p.x) * e,
              y: p.y + (endPoints[i].y - p.y) * e,
            }));
            if (options.spreadOutward) {
              nextPoints = applyOutwardSpread(nextPoints, e);
            }
            fromPath.setAttribute('d', pointsToD(nextPoints));
            fromPath.setAttribute('stroke-width', '1.5');
            if (t < 1) {
              (fromPath as SVGPathElement & { _aiMorphRaf?: number })._aiMorphRaf = requestAnimationFrame(step);
            } else {
              fromPath.setAttribute('d', pointsToD(endPoints));
              fromPath.setAttribute('stroke-width', '1.5');
              if (onComplete) {
                onComplete();
              }
            }
          };
          (fromPath as SVGPathElement & { _aiMorphRaf?: number })._aiMorphRaf = requestAnimationFrame(step);
        };

        const setFinalIconState = (state: 'loop' | 'line') => {
          morphPath.style.opacity = '0';
          loopTarget.style.opacity = state === 'loop' ? '1' : '0';
          lineTarget.style.opacity = state === 'line' ? '1' : '0';
          icon.dataset.aiOutputState = state;
        };

        const currentState = (icon.dataset.aiOutputState as 'loop' | 'line') ?? 'line';
        const targetState = collapsed ? 'loop' : 'line';
        if (currentState === targetState) {
          setFinalIconState(targetState);
          return;
        }

        const startPath = currentState === 'loop' ? loopTarget : lineTarget;
        const endPath = targetState === 'loop' ? loopTarget : lineTarget;
        if (!startPath || !endPath) {
          setFinalIconState(targetState);
          return;
        }

        morphPath.setAttribute('d', startPath.getAttribute('d') ?? '');
        morphPath.style.opacity = '1';
        loopTarget.style.opacity = '0';
        lineTarget.style.opacity = '0';

        const animateOptions = collapsed ? {} : { spreadOutward: true };
        animateMorph(morphPath, endPath, 220, animateOptions, () => setFinalIconState(targetState));
      }
    }
  }, []);

  const stripAiFromOutput = useCallback((container: HTMLElement) => {
    const body = container.querySelector('[data-ai-output-body="true"]') as HTMLElement | null;
    if (!body) return;

    clearAiHiddenState(body);

    const aiSelectors = '[data-ai-origin="true"], [data-ai-text="true"], [data-ai-question="true"], span[role="link"]';
    const aiElements = Array.from(body.querySelectorAll(aiSelectors)) as HTMLElement[];

    const extractAllowedContent = (node: Node, fragment: DocumentFragment) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.getAttribute('data-ai-highlighted') === 'true') {
          fragment.appendChild(el.cloneNode(true));
          return;
        }
        if (isHumanTextSpan(el)) {
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

    body.querySelectorAll('[data-ai-output-spacer="true"]').forEach((spacer) => spacer.remove());
    body.querySelectorAll('[data-ai-output-toggle="true"]').forEach((toggle) => toggle.remove());

    const outputFragment = document.createDocumentFragment();
    while (body.firstChild) {
      outputFragment.appendChild(body.firstChild);
    }
    container.replaceWith(outputFragment);
  }, []);

  const refreshCollapsedAiOutputs = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const collapsedOutputs = Array.from(root.querySelectorAll('[data-ai-output="true"][data-ai-output-collapsed="true"]')) as HTMLElement[];
    collapsedOutputs.forEach((output) => {
      setAiOutputCollapsed(output, true, false);
    });
  }, [setAiOutputCollapsed]);

  const ensureHighlightVisibility = useCallback((root: HTMLElement) => {
    const highlights = Array.from(root.querySelectorAll('[data-ai-highlighted="true"]')) as HTMLElement[];
    highlights.forEach((highlight) => {
      highlight.removeAttribute('data-ai-hidden');
      let node = highlight.parentElement;
      while (node && node !== root) {
        if (node.getAttribute('data-ai-hidden') === 'true') {
          node.setAttribute('data-ai-contains-highlight', 'true');
        }
        node = node.parentElement;
      }
    });
  }, []);

  const rehydrateAiOutputs = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const outputs = Array.from(root.querySelectorAll('[data-ai-output="true"]')) as HTMLElement[];
    outputs.forEach((output) => {
      const collapsed = output.getAttribute('data-ai-output-collapsed') === 'true';
      setAiOutputCollapsed(output, collapsed, false);
    });
    ensureHighlightVisibility(root);
  }, [ensureHighlightVisibility, setAiOutputCollapsed]);

  const handleAiOutputInserted = useCallback((outputContainer: HTMLElement) => {
    const root = editorRef.current;
    if (!root) return;
    const outputs = Array.from(root.querySelectorAll('[data-ai-output="true"]')) as HTMLElement[];
    outputs.forEach((output) => {
      if (output === outputContainer) {
        setAiOutputCollapsed(output, false);
      } else {
        setAiOutputCollapsed(output, true);
      }
    });
    persistViewedSourcesForOutput(doc.id, outputContainer);
    if (onAiReview) {
      onAiReview(doc.id, { aiReviewedAt: new Date().toISOString() });
    }
    scheduleEditorEmptyUpdateRef.current();
    scheduleAutosaveRef.current();
    queueHistorySnapshotRef.current();
  }, [
    doc.id,
    onAiReview,
    persistViewedSourcesForOutput,
    setAiOutputCollapsed,
  ]);

  const { handleAiReview, cancelReview, isLoading, aiLoading, aiError, isSearching, setAiError } = useSearchAgent(
    editorRef,
    doc.id,
    selectedModel,
    hydrateSearchResultImages,
    handleAiOutputInserted
  );

  useEffect(() => {
    if (!autoFocus) return;
    if (!editorRef.current) return;
    const node = editorRef.current;
    node.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [autoFocus, doc.id]);


  // Track selection changes to support toolbar actions that steal focus (like Select)
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && editorRef.current) {
        const range = selection.getRangeAt(0);
        if (editorRef.current.contains(range.commonAncestorContainer)) {
          lastKnownRange.current = range.cloneRange();
        }
      }
      if (editorRef.current?.querySelector('[data-ai-output="true"][data-ai-output-collapsed="true"]')) {
        refreshCollapsedAiOutputs();
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [refreshCollapsedAiOutputs]);

  // Auto-set margin side when there are texts
  useEffect(() => {
    if (marginTexts.length > 0 && marginSide === null) {
      setMarginSide('left');
    } else if (marginTexts.length === 0) {
      setMarginSide(null);
    }
  }, [marginTexts, marginSide]);

  // Helper function to normalize content structure
  const normalizeContent = useCallback(() => {
    if (!editorRef.current) return;

    const children = Array.from(editorRef.current.childNodes);
    let needsNormalization = false;

    // Check if there are any text nodes or inline elements at the root level
    for (const childNode of children) {
      const child = childNode as Node;
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        needsNormalization = true;
        break;
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        const elem = child as Element;
        if (!['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'UL', 'OL', 'BLOCKQUOTE'].includes(elem.tagName)) {
          needsNormalization = true;
          break;
        }
      }
    }

    if (needsNormalization || children.length === 0) {
      const fragment = document.createDocumentFragment();
      let currentP: HTMLParagraphElement | null = null;

      for (const childNode of children) {
        const child = childNode as Node;
        if (child.nodeType === Node.TEXT_NODE ||
          (child.nodeType === Node.ELEMENT_NODE &&
            !['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'UL', 'OL', 'BLOCKQUOTE'].includes((child as Element).tagName))) {
          // Wrap in a paragraph
          if (!currentP) {
            currentP = document.createElement('p');
            currentP.style.lineHeight = '1.5';
            fragment.appendChild(currentP);
          }
          currentP.appendChild(child.cloneNode(true));
        } else {
          // Block element - add as is
          currentP = null;
          const blockElem = child.cloneNode(true) as HTMLElement;
          if (!blockElem.style.lineHeight) {
            blockElem.style.lineHeight = '1.5';
          }
          fragment.appendChild(blockElem);
        }
      }

      // Save cursor position
      const selection = window.getSelection();
      const savedSelection = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;

      editorRef.current.innerHTML = '';
      editorRef.current.appendChild(fragment);

      // Restore cursor position if possible
      if (savedSelection && selection) {
        try {
          selection.removeAllRanges();
          selection.addRange(savedSelection);
        } catch (e) {
          // Silently fail if restoration doesn't work
        }
      }
    }
  }, []);

  const isPlaceholderHtml = useCallback((html: string) => {
    if (!hasPlaceholder) return false;
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return text === placeholderText;
  }, [hasPlaceholder, placeholderText]);

  const updateEditorEmpty = useCallback(() => {
    const text = normalizeWhitespace(editorRef.current?.textContent ?? '');
    const empty = !text || (!useOverlayPlaceholder && hasPlaceholder && text === placeholderText);
    setIsEditorEmpty(empty);
  }, [hasPlaceholder, placeholderText, useOverlayPlaceholder]);

  const signalFirstInput = useCallback(() => {
    if (hasUserInputRef.current) return;
    hasUserInputRef.current = true;
    if (!onFirstInput || !editorRef.current) return;
    requestAnimationFrame(() => {
      if (!editorRef.current) return;
      onFirstInput(editorRef.current.innerHTML);
    });
  }, [onFirstInput]);

  const scheduleEditorEmptyUpdate = useCallback(() => {
    requestAnimationFrame(() => {
      updateEditorEmpty();
    });
  }, [updateEditorEmpty]);
  scheduleEditorEmptyUpdateRef.current = scheduleEditorEmptyUpdate;

  useEffect(() => {
    hasUserInputRef.current = false;
    didNotifyEmptyRef.current = false;
    updateEditorEmpty();
  }, [doc.id, updateEditorEmpty]);

  useEffect(() => {
    if (!isDraftActive || !onDraftEmpty) return;
    if (!isEditorEmpty) {
      didNotifyEmptyRef.current = false;
      return;
    }
    if (didNotifyEmptyRef.current) return;
    didNotifyEmptyRef.current = true;
    onDraftEmpty();
  }, [isDraftActive, isEditorEmpty, onDraftEmpty]);

  const handleEditorInput = () => {
    requestAnimationFrame(() => {
      const text = normalizeWhitespace(editorRef.current?.textContent ?? '');
      updateEditorEmpty();
      if (text) {
        if (!hasUserInputRef.current) {
          signalFirstInput();
        }
        didNotifyEmptyRef.current = false;
      } else if (isDraftActive && onDraftEmpty && !didNotifyEmptyRef.current) {
        didNotifyEmptyRef.current = true;
        onDraftEmpty();
      }
    });
    scheduleAutosave();
    queueHistorySnapshot();
  };

  const isAiElement = useCallback((el: HTMLElement): boolean => {
    return el.getAttribute('data-ai-text') === 'true' || el.getAttribute('data-ai-origin') === 'true';
  }, []);

  const isUiMutationNode = useCallback((node: Node): boolean => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement;
    if (!element) return false;
    if (element.closest('.ai-loading-shimmer')) return true;
    if (element.closest('[data-loading-phase]')) return true;
    return Boolean(
      element.closest('[data-ai-ui="true"], [data-ai-output-toggle="true"], [data-ai-output-spacer="true"], [data-ai-output-icon="true"], [data-ai-output-label="true"]')
    );
  }, []);


  // Load saved content on mount
  useEffect(() => {
    document.execCommand('defaultParagraphSeparator', false, 'p');
    if (!editorRef.current) return;
    isHydratingRef.current = true;
    if (!doc.content || isPlaceholderHtml(doc.content)) {
      isHydratingRef.current = false;
      return;
    }

    if (editorRef.current.innerHTML === doc.content) {
      isHydratingRef.current = false;
      return;
    }

    editorRef.current.innerHTML = doc.content;
    requestAnimationFrame(() => {
      if (!editorRef.current) {
        isHydratingRef.current = false;
        return;
      }
      hydrateSearchResultImages(editorRef.current);
      normalizeContent();
      rehydrateViewedSourcesToggles(editorRef.current);
      rehydrateSourceLinks(editorRef.current);
      rehydrateInteractiveSources(editorRef.current);
      persistViewedSourcesForDoc(doc.id, editorRef.current);
      updateEditorEmpty();

      editorRef.current.querySelectorAll<HTMLElement>('[data-ai-output-toggle="true"]').forEach((toggle) => {
        toggle.dataset.aiUi = 'true';
        const icon = toggle.querySelector<HTMLElement>('[data-ai-output-icon="true"]');
        if (icon) icon.dataset.aiUi = 'true';
        const label = toggle.querySelector<HTMLElement>('[data-ai-output-label="true"]');
        if (label) {
          label.dataset.aiUi = 'true';
          const container = toggle.closest('[data-ai-output="true"]') as HTMLElement | null;
          if (container) {
            const collapsed = container.getAttribute('data-ai-output-collapsed') === 'true';
            label.textContent = getAiOutputLabelText(container, collapsed);
          }
        }
        toggle.removeAttribute('data-ai-hidden');
        toggle.querySelectorAll<HTMLElement>('[data-ai-hidden="true"]').forEach((el) => {
          el.removeAttribute('data-ai-hidden');
        });
      });

      // Tag existing AI text
      editorRef.current.querySelectorAll('[data-ai-text="true"]').forEach((el) => {
        (el as HTMLElement).setAttribute('data-ai-origin', 'true');
      });

      const spans = editorRef.current.querySelectorAll('span');
      spans.forEach((span: HTMLSpanElement) => {
        if (span.closest('[data-ai-output-toggle="true"]')) return;
        if (span.getAttribute('data-ai-highlighted') === 'true') return;
        if (isAiTextSpan(span) || span.querySelector('svg')) { // Simple check for likely AI text or source links
          if (isAiTextSpan(span) || span.getAttribute('role') === 'link') {
            span.setAttribute('data-ai-text', 'true');
            span.setAttribute('data-ai-origin', 'true');
            const parent = span.parentElement;
            if (parent && parent !== editorRef.current) {
              const onlyAiChildren = Array.from(parent.childNodes).every((node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                  return !(node.textContent || '').trim();
                }
                if (node.nodeType === Node.ELEMENT_NODE) {
                  const el = node as HTMLElement;
                  if (el.tagName === 'BR') return true;
                  if (el.getAttribute('data-ai-highlighted') === 'true') return true;
                  return el.getAttribute('data-ai-origin') === 'true' || isAiTextSpan(el);
                }
                return false;
              });
              if (onlyAiChildren) {
                parent.setAttribute('data-ai-origin', 'true');
              }
            }
          }
        }
      });

      editorRef.current.querySelectorAll<HTMLElement>('[data-human-text="true"]').forEach((el) => {
        const block = el.closest('p, div, li, h1, h2, h3, h4, h5, h6, blockquote') as HTMLElement | null;
        if (block) block.setAttribute('data-human-block', 'true');
      });

      rehydrateAiOutputs();
      const normalizedHtml = isPlaceholderHtml(editorRef.current.innerHTML) ? '' : editorRef.current.innerHTML;
      const history = historyStateRef.current;
      if (history.stack.length === 1 && history.index === 0 && history.stack[0] !== normalizedHtml) {
        history.stack[0] = normalizedHtml;
        lastSnapshotRef.current = normalizedHtml;
        persistHistoryStateRef.current();
      }
      isHydratingRef.current = false;
    });
  }, [
    doc.content,
    doc.id,
    hydrateSearchResultImages,
    isPlaceholderHtml,
    normalizeContent,
    rehydrateAiOutputs,
    rehydrateViewedSourcesToggles,
    rehydrateSourceLinks,
    rehydrateInteractiveSources,
    persistViewedSourcesForDoc,
    updateEditorEmpty,
  ]);


  useEffect(() => {
    rehydrateAiOutputs();
  }, [rehydrateAiOutputs]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const ctrlKey = isMac ? e.metaKey : e.ctrlKey;

      const isEditorFocused = editorRef.current?.contains(document.activeElement);

      if (isEditorFocused && !ctrlKey && !e.altKey && e.key.length === 1 && !e.metaKey) {
        const isPrintable = e.key.length === 1 && e.key !== 'Enter' && e.key !== 'Tab' && e.key !== 'Escape';
        if (isPrintable) {
          e.preventDefault();
          e.stopPropagation();
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0 && editorRef.current) {
            insertStyledText(e.key);
          }
          return;
        }
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        window.getSelection()?.removeAllRanges();
        return;
      }

      if (ctrlKey && e.key === 'b') {
        e.preventDefault();
        document.execCommand('bold');
      }

      if (ctrlKey && e.key === 'i') {
        e.preventDefault();
        document.execCommand('italic');
      }

      if (ctrlKey && e.key === 'u') {
        e.preventDefault();
        document.execCommand('underline');
      }

      if (ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSaveRef.current();
      }

      if (ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndoRef.current();
      }

      if ((ctrlKey && e.key === 'y') || (ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        handleRedoRef.current();
      }

      if (ctrlKey && e.key === '/') {
        e.preventDefault();
        setShowShortcuts((prev: boolean) => !prev);
      }

      if (isEditorFocused && ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleAiReview();
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleAiReview]);

  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(event.target.value);
  };

  const generateTitleFromContent = useCallback(
    async (text: string, content: string) => {
      if (isTitleGenerating) return;
      if (titleGeneratedRef.current.has(doc.id)) return;
      setIsTitleGenerating(true);
      try {
        const result = await generateWithOpenAI('title', text, selectedModel);
        if (result.ok) {
          const cleaned = result.text.replace(/[\r\n]+/g, ' ').trim();
          if (cleaned) {
            onSave(doc.id, content, cleaned);
            titleGeneratedRef.current.add(doc.id);
          }
        }
      } finally {
        setIsTitleGenerating(false);
      }
    },
    [doc.id, isTitleGenerating, onSave, selectedModel]
  );

  const persistDocument = useCallback((showNotification: boolean) => {
    if (!editorRef.current) return;

    const rawContent = editorRef.current.innerHTML;
    const textContent = normalizeWhitespace(editorRef.current.textContent || '');
    const isPlaceholder = !textContent || (!useOverlayPlaceholder && hasPlaceholder && textContent === placeholderText);
    const content = isPlaceholder ? '' : rawContent;
    const title = !textContent || isPlaceholder ? 'Untitled' : doc.title || 'Untitled';

    persistViewedSourcesForDoc(doc.id, editorRef.current);
    onSave(doc.id, content, title);

    if (!isPlaceholder && textContent && doc.title === 'Untitled') {
      generateTitleFromContent(textContent, content);
    }

    if (showNotification) {
      const notification = document.createElement('div');
      notification.textContent = 'Document saved!';
      notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
      document.body.appendChild(notification);
      setTimeout(() => notification.remove(), 2000);
    }
  }, [doc.id, doc.title, generateTitleFromContent, onSave, placeholderText, useOverlayPlaceholder]);

  const clearAutosave = () => {
    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
  };

  const scheduleAutosave = useCallback(() => {
    clearAutosave();
    autosaveTimeoutRef.current = window.setTimeout(() => {
      autosaveTimeoutRef.current = null;
      persistDocument(false);
    }, 800);
  }, [persistDocument]);
  scheduleAutosaveRef.current = scheduleAutosave;

  const flushPendingAutosave = useCallback(() => {
    if (!autosaveTimeoutRef.current) return;
    window.clearTimeout(autosaveTimeoutRef.current);
    autosaveTimeoutRef.current = null;
    persistDocument(false);
  }, [persistDocument]);

  const getHistoryStorageKey = useCallback(() => `${HISTORY_STORAGE_PREFIX}.${doc.id}`, [doc.id]);

  const persistHistoryState = useCallback((state: { stack: string[]; index: number } = historyStateRef.current) => {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.setItem(getHistoryStorageKey(), JSON.stringify(state));
    } catch {
      // Ignore storage failures
    }
  }, [getHistoryStorageKey]);
  persistHistoryStateRef.current = () => persistHistoryState();

  const readHistoryState = useCallback(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(getHistoryStorageKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.stack)) return null;
      const stack = parsed.stack.filter((entry: unknown): entry is string => typeof entry === 'string');
      if (stack.length === 0) return null;
      let index = typeof parsed.index === 'number' ? parsed.index : stack.length - 1;
      if (!Number.isFinite(index)) index = stack.length - 1;
      if (stack.length > HISTORY_LIMIT) {
        const overflow = stack.length - HISTORY_LIMIT;
        stack.splice(0, overflow);
        index = Math.max(index - overflow, 0);
      }
      index = Math.min(Math.max(index, 0), stack.length - 1);
      return { stack, index };
    } catch {
      return null;
    }
  }, [getHistoryStorageKey]);

  const getHistoryHtml = useCallback(() => {
    if (!editorRef.current) return '';
    const html = editorRef.current.innerHTML;
    return isPlaceholderHtml(html) ? '' : html;
  }, [isPlaceholderHtml]);

  const queueHistorySnapshot = useCallback(() => {
    if (historySnapshotTimeoutRef.current) {
      window.clearTimeout(historySnapshotTimeoutRef.current);
    }
    historySnapshotTimeoutRef.current = window.setTimeout(() => {
      historySnapshotTimeoutRef.current = null;
      if (isApplyingHistoryRef.current || isHydratingRef.current) return;
      const html = getHistoryHtml();
      const history = historyStateRef.current;
      if (history.stack.length === 0 || history.index < 0) {
        history.stack = [html];
        history.index = 0;
        lastSnapshotRef.current = html;
        persistHistoryState();
        return;
      }
      if (html === lastSnapshotRef.current) return;
      if (history.index < history.stack.length - 1) {
        history.stack = history.stack.slice(0, history.index + 1);
      }
      history.stack.push(html);
      if (history.stack.length > HISTORY_LIMIT) {
        const overflow = history.stack.length - HISTORY_LIMIT;
        history.stack.splice(0, overflow);
      }
      history.index = history.stack.length - 1;
      lastSnapshotRef.current = html;
      persistHistoryState();
    }, HISTORY_SNAPSHOT_DELAY);
  }, [getHistoryHtml, persistHistoryState]);
  queueHistorySnapshotRef.current = queueHistorySnapshot;

  const clearHistorySnapshot = useCallback(() => {
    if (historySnapshotTimeoutRef.current) {
      window.clearTimeout(historySnapshotTimeoutRef.current);
      historySnapshotTimeoutRef.current = null;
    }
  }, []);

  const applyHistorySnapshot = useCallback((targetIndex: number) => {
    const root = editorRef.current;
    if (!root) return;
    const history = historyStateRef.current;
    if (history.stack.length === 0) return;
    const safeIndex = Math.min(Math.max(targetIndex, 0), history.stack.length - 1);
    const html = history.stack[safeIndex] ?? '';
    history.index = safeIndex;
    lastSnapshotRef.current = html;
    persistHistoryState();
    isApplyingHistoryRef.current = true;
    root.innerHTML = html;
    requestAnimationFrame(() => {
      if (!editorRef.current) {
        isApplyingHistoryRef.current = false;
        return;
      }
      hydrateSearchResultImages(editorRef.current);
      normalizeContent();
      rehydrateViewedSourcesToggles(editorRef.current);
      rehydrateSourceLinks(editorRef.current);
      rehydrateInteractiveSources(editorRef.current);
      persistViewedSourcesForDoc(doc.id, editorRef.current);
      rehydrateAiOutputs();
      updateEditorEmpty();
      isApplyingHistoryRef.current = false;
      scheduleAutosave();
    });
  }, [
    doc.id,
    hydrateSearchResultImages,
    normalizeContent,
    persistHistoryState,
    persistViewedSourcesForDoc,
    rehydrateAiOutputs,
    rehydrateInteractiveSources,
    rehydrateSourceLinks,
    rehydrateViewedSourcesToggles,
    scheduleAutosave,
    updateEditorEmpty,
  ]);

  const handleUndo = useCallback(() => {
    const history = historyStateRef.current;
    if (history.index <= 0) return;
    clearAutosave();
    applyHistorySnapshot(history.index - 1);
  }, [applyHistorySnapshot, clearAutosave]);
  handleUndoRef.current = handleUndo;

  const handleRedo = useCallback(() => {
    const history = historyStateRef.current;
    if (history.index >= history.stack.length - 1) return;
    clearAutosave();
    applyHistorySnapshot(history.index + 1);
  }, [applyHistorySnapshot, clearAutosave]);
  handleRedoRef.current = handleRedo;

  useEffect(() => {
    if (initializedHistoryDocIdRef.current === doc.id) return;
    initializedHistoryDocIdRef.current = doc.id;
    clearHistorySnapshot();
    const initialHtml = doc.content && !isPlaceholderHtml(doc.content) ? doc.content : '';
    const stored = readHistoryState();
    if (stored && stored.stack[stored.index] === initialHtml) {
      historyStateRef.current = stored;
      lastSnapshotRef.current = stored.stack[stored.index] ?? initialHtml;
      return;
    }
    historyStateRef.current = { stack: [initialHtml], index: 0 };
    lastSnapshotRef.current = initialHtml;
    persistHistoryState();
  }, [clearHistorySnapshot, doc.content, doc.id, isPlaceholderHtml, persistHistoryState, readHistoryState]);

  useEffect(() => {
    return () => clearHistorySnapshot();
  }, [clearHistorySnapshot]);

  useEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    const observer = new MutationObserver((mutations) => {
      if (isApplyingHistoryRef.current || isHydratingRef.current) return;
      let shouldTrack = false;
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          if (!isUiMutationNode(mutation.target)) {
            shouldTrack = true;
            break;
          }
          continue;
        }
        if (mutation.type === 'childList') {
          const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
          if (nodes.length === 0) continue;
          if (nodes.some((node) => !isUiMutationNode(node))) {
            shouldTrack = true;
            break;
          }
        }
      }
      if (!shouldTrack) return;
      scheduleEditorEmptyUpdate();
      scheduleAutosave();
      queueHistorySnapshot();
    });
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [doc.id, isUiMutationNode, queueHistorySnapshot, scheduleAutosave, scheduleEditorEmptyUpdate]);

  useEffect(() => {
    return () => flushPendingAutosave();
  }, [flushPendingAutosave]);

  useEffect(() => {
    clearAutosave();
  }, [doc.id]);

  const handleSave = () => {
    clearAutosave();
    persistDocument(true);
  };
  handleSaveRef.current = handleSave;

  const checkClickInSelection = (x: number, y: number): boolean => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return false;

    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return true;
      }
    }
    return false;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const selection = window.getSelection();

    if (e.shiftKey && selection && !selection.isCollapsed) {
      e.preventDefault();
      const currentRange = selection.getRangeAt(0).cloneRange();
      setAdditionalSelections((prev: Range[]) => [...prev, currentRange]);
      setIsShiftSelecting(true);
      shiftSelectStart.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (selection && !selection.isCollapsed && checkClickInSelection(e.clientX, e.clientY) && !e.shiftKey) {
      e.preventDefault();
      const mainRange = selection.getRangeAt(0);
      const allRanges = [mainRange, ...additionalSelections];

      const combinedFragment = document.createDocumentFragment();
      let combinedText = '';

      allRanges.forEach((range, index) => {
        const clonedContents = range.cloneContents();
        const container = range.commonAncestorContainer;
        const element = container.nodeType === Node.ELEMENT_NODE
          ? container as HTMLElement
          : container.parentElement;

        if (element) {
          const computedStyle = window.getComputedStyle(element);
          const wrapper = document.createElement('span');
          wrapper.style.fontFamily = computedStyle.fontFamily;
          wrapper.style.fontSize = computedStyle.fontSize;
          wrapper.style.fontWeight = computedStyle.fontWeight;
          wrapper.style.fontStyle = computedStyle.fontStyle;
          wrapper.style.color = computedStyle.color;
          wrapper.style.textDecoration = computedStyle.textDecoration;
          wrapper.style.lineHeight = computedStyle.lineHeight;
          wrapper.appendChild(clonedContents);
          combinedFragment.appendChild(wrapper);
        } else {
          combinedFragment.appendChild(clonedContents);
        }

        combinedText += range.toString();
        if (index < allRanges.length - 1) {
          combinedText += ' ';
        }
      });

      savedRange.current = mainRange.cloneRange();
      draggedFragment.current = combinedFragment;
      setDraggedContent(combinedText);
      setIsDragging(true);
      dragStartPos.current = { x: e.clientX, y: e.clientY };
    } else if (!e.shiftKey) {
      setAdditionalSelections([]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && dragStartPos.current) {
      setIsDuplicating(e.altKey);
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) {
        document.body.style.cursor = 'grabbing';
        setDragElementPos({ x: e.clientX, y: e.clientY });

        if (editorRef.current && containerRef.current) {
          const editorRect = editorRef.current.getBoundingClientRect();

          if (e.clientX < editorRect.left) {
            setDragTarget('left-margin');
            setDropCursorPos(null);
          } else if (e.clientX > editorRect.right) {
            setDragTarget('right-margin');
            setDropCursorPos(null);
          } else if (e.clientX >= editorRect.left && e.clientX <= editorRect.right) {
            setDragTarget('editor');

            const lines: { top: number; bottom: number; left: number }[] = [];

            // Snapping logic
            const blockElements = editorRef.current.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div, li');
            blockElements.forEach((element: Element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              const rects = range.getClientRects();
              for (let i = 0; i < rects.length; i++) {
                const rect = rects[i];
                if (rect.height > 0 && rect.width > 0) {
                  lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left });
                }
              }
            });

            const walker = document.createTreeWalker(editorRef.current, NodeFilter.SHOW_TEXT, {
              acceptNode: (node) => {
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                const isInBlock = parent.closest('p, h1, h2, h3, h4, h5, h6, div, li');
                return !isInBlock ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
              }
            });
            let node;
            while (node = walker.nextNode()) {
              if (node.textContent?.trim()) {
                const range = document.createRange();
                range.selectNodeContents(node);
                const rects = range.getClientRects();
                for (let i = 0; i < rects.length; i++) {
                  const rect = rects[i];
                  if (rect.height > 0 && rect.width > 0) {
                    lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left });
                  }
                }
              }
            }
            lines.sort((a, b) => a.top - b.top);

            let targetLine: { top: number; bottom: number; left: number } | null = null;
            for (const line of lines) {
              if (e.clientY >= line.top && e.clientY <= line.bottom) {
                targetLine = line;
                break;
              }
            }
            if (!targetLine) {
              for (let i = 0; i < lines.length - 1; i++) {
                const currentLine = lines[i];
                const nextLine = lines[i + 1];
                if (e.clientY > currentLine.bottom && e.clientY < nextLine.top) {
                  const gapMidpoint = (currentLine.bottom + nextLine.top) / 2;
                  targetLine = e.clientY < gapMidpoint ? currentLine : nextLine;
                  break;
                }
              }
            }

            const lastLine = lines.length > 0 ? lines[lines.length - 1] : null;
            const editorTop = editorRect.top;

            if (!targetLine || (lastLine && e.clientY > lastLine.bottom + 10)) {
              const startY = lastLine ? lastLine.bottom : editorTop;
              const avgLineHeight = lastLine ? (lastLine.bottom - lastLine.top) : 28;
              const relativeY = e.clientY - startY;
              const virtualLineIndex = Math.round(relativeY / avgLineHeight);
              const snappedY = startY + (virtualLineIndex * avgLineHeight);
              setDropCursorPos({ x: e.clientX, y: snappedY });
            } else if (targetLine) {
              setDropCursorPos({ x: e.clientX, y: targetLine.top });
            }
          }
        }
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isDragging && savedRange.current && draggedFragment.current) {
      e.preventDefault();

      if (dragTarget === 'left-margin' || dragTarget === 'right-margin') {
        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const id = `margin-text-${Date.now()}-${Math.random()}`;
          const content = draggedContent;
          const tempDiv = document.createElement('div');
          tempDiv.appendChild(draggedFragment.current.cloneNode(true));
          const htmlContent = tempDiv.innerHTML;
          const newSide = dragTarget === 'left-margin' ? 'left' : 'right';
          let marginX = 0;
          let marginY = e.clientY - containerRect.top;

          if (newSide === 'left') {
            marginX = e.clientX - containerRect.left;
          } else {
            const editorRect = editorRef.current?.getBoundingClientRect();
            if (editorRect) {
              marginX = e.clientX - editorRect.right - 1;
            }
          }

          setMarginSide(newSide);
          setMarginTexts((prev: any[]) => [...prev, { id, content, htmlContent, x: marginX, y: marginY }]);
          window.getSelection()?.removeAllRanges();
        }
      } else {
        if (editorRef.current && draggedFragment.current && dropCursorPos) {
          if (!isDuplicating) {
            const rangeToDelete = savedRange.current;
            rangeToDelete.deleteContents();
          }

          const lines: { top: number; bottom: number }[] = [];
          const walker = document.createTreeWalker(editorRef.current, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
          const seenLines = new Set<number>();
          let node;
          while (node = walker.nextNode()) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
              const r = document.createRange(); r.selectNodeContents(node);
              Array.from(r.getClientRects()).forEach(rect => {
                const k = Math.round(rect.top);
                if (!seenLines.has(k)) { seenLines.add(k); lines.push({ top: rect.top, bottom: rect.bottom }); }
              });
            } else if (node.nodeType === Node.ELEMENT_NODE && (node as Element).matches('h1,h2,h3,h4,h5,h6,p,div,li')) {
              const rect = (node as Element).getBoundingClientRect();
              if (rect.height > 0) {
                const k = Math.round(rect.top);
                if (!seenLines.has(k)) { seenLines.add(k); lines.push({ top: rect.top, bottom: rect.bottom }); }
              }
            }
          }
          lines.sort((a, b) => a.top - b.top);
          const lastLine = lines[lines.length - 1];
          const isBelowContent = lastLine && dropCursorPos.y > lastLine.bottom + 10;

          if (isBelowContent) {
            const avgLineHeight = lastLine.bottom - lastLine.top;
            const distanceBelow = dropCursorPos.y - lastLine.bottom;
            const linesBelow = Math.round(distanceBelow / avgLineHeight);
            const range = document.createRange();
            const lastChild = editorRef.current.lastChild;
            if (lastChild) {
              if (lastChild.nodeType === Node.TEXT_NODE) range.setStart(lastChild, lastChild.textContent?.length || 0);
              else range.setStartAfter(lastChild);
            } else {
              range.setStart(editorRef.current, 0);
            }
            range.collapse(true);
            for (let i = 0; i < linesBelow; i++) {
              const br = document.createElement('br');
              range.insertNode(br);
              range.setStartAfter(br);
            }
            const fragmentToInsert = draggedFragment.current.cloneNode(true) as DocumentFragment;
            const wrapper = document.createDocumentFragment();
            while (fragmentToInsert.firstChild) wrapper.appendChild(fragmentToInsert.firstChild);
            range.insertNode(wrapper);

            claimAiContent(range.commonAncestorContainer);
          } else {
            let range = document.caretRangeFromPoint(e.clientX, e.clientY);
            if (range && editorRef.current && draggedFragment.current) {
              const fragmentToInsert = draggedFragment.current.cloneNode(true) as DocumentFragment;
              const wrapper = document.createDocumentFragment();
              while (fragmentToInsert.firstChild) wrapper.appendChild(fragmentToInsert.firstChild);
              range.insertNode(wrapper);
              claimAiContent(range.commonAncestorContainer);
            }
          }
          window.getSelection()?.removeAllRanges();
        }
      }

      document.body.style.cursor = '';
      setIsDragging(false);
      setDraggedContent('');
      savedRange.current = null;
      dragStartPos.current = null;
      setDropCursorPos(null);
      setDragElementPos(null);
      draggedFragment.current = null;
      setDragTarget(null);
      setAdditionalSelections([]);
      setIsShiftSelecting(false);
      shiftSelectStart.current = null;
    } else {
      // Handle AI text highlighting on selection
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && editorRef.current) {
        const range = selection.getRangeAt(0);
        if (isSelectionInCollapsedOutput(range)) {
          return;
        }

        // Check if selection involves AI text
        const container = range.commonAncestorContainer;
        const parent = container.nodeType === Node.TEXT_NODE ? container.parentElement : container as HTMLElement;
        const isAiRelated = parent?.getAttribute('data-ai-text') === 'true' || parent?.closest('[data-ai-text="true"]');

        if (isAiRelated) {
          const textNodes: Text[] = [];

          const isNodeAiText = (node: Node) => {
            const p = node.parentElement;
            return p && (p.getAttribute('data-ai-text') === 'true' || p.closest('[data-ai-text="true"]'));
          };

          const walker = document.createTreeWalker(
            range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentElement! : range.commonAncestorContainer,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode: (node) => {
                if (isNodeAiText(node) && range.intersectsNode(node)) return NodeFilter.FILTER_ACCEPT;
                return NodeFilter.FILTER_REJECT;
              }
            }
          );

          if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE && isNodeAiText(range.commonAncestorContainer)) {
            textNodes.push(range.commonAncestorContainer as Text);
          } else {
            let n;
            while (n = walker.nextNode()) textNodes.push(n as Text);
          }

          if (textNodes.length > 0) {
            const allHighlighted = textNodes.every(node => node.parentElement?.getAttribute('data-ai-highlighted') === 'true');
            const shouldHighlight = !allHighlighted;

            textNodes.forEach(node => {
              let target = node;
              if (node === range.startContainer && range.startOffset > 0 && range.startOffset < node.length) {
                target = node.splitText(range.startOffset);
              }
              if (node === range.endContainer || target === range.endContainer) {
                const currentEndOffset = range.endOffset;
                if (range.endContainer === node) {
                  const relativeOffset = currentEndOffset - (target === node ? 0 : range.startOffset);
                  if (relativeOffset > 0 && relativeOffset < target.length) {
                    target.splitText(relativeOffset);
                  }
                } else if (range.endContainer === target) {
                  if (currentEndOffset > 0 && currentEndOffset < target.length) {
                    target.splitText(currentEndOffset);
                  }
                }
              }

              const cp = target.parentElement!;
              if (shouldHighlight) {
                if (cp.getAttribute('data-ai-highlighted') === 'true') return;
                const span = document.createElement('span');
                span.setAttribute('data-ai-highlighted', 'true');
                span.setAttribute('data-ai-highlighted-at', String(Date.now()));
                span.setAttribute('data-ai-highlight-variant', String(Math.floor(Math.random() * 4)));

                const style = window.getComputedStyle(cp);
                span.style.fontFamily = style.fontFamily;
                span.style.fontSize = style.fontSize;
                span.style.color = style.color;
                span.style.lineHeight = style.lineHeight;
                target.parentNode?.insertBefore(span, target);
                span.appendChild(target);
              } else {
                let wrapper = target.parentElement!;
                if (wrapper.getAttribute('data-ai-highlighted') === 'true') {
                  const pNode = wrapper.parentNode!;
                  while (wrapper.firstChild) pNode.insertBefore(wrapper.firstChild, wrapper);
                  wrapper.remove();
                }
              }
            });
            normalizeAiHighlightSpans(editorRef.current);
          }
        }
      }
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const toggle = target?.closest('[data-ai-output-toggle="true"]') as HTMLElement | null;
    if (toggle) {
      e.preventDefault();
      e.stopPropagation();
      const container = toggle.closest('[data-ai-output="true"]') as HTMLElement | null;
      if (container) {
        const iconOrLabel = (target as HTMLElement).closest('[data-ai-output-icon="true"], [data-ai-output-label="true"]');
        if (iconOrLabel) {
          const isCollapsed = container.getAttribute('data-ai-output-collapsed') === 'true';
          setAiOutputCollapsed(container, !isCollapsed);
          return;
        }
        const caret = toggle.querySelector('[data-ai-output-caret="true"]') as HTMLElement | null;
        if (caret) {
          const selection = window.getSelection();
          const range = document.createRange();
          if (caret.firstChild && caret.firstChild.nodeType === Node.TEXT_NODE) {
            range.setStart(caret.firstChild, caret.firstChild.textContent?.length ?? 0);
          } else {
            range.setStart(caret, caret.childNodes.length);
          }
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      }
      return;
    }

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && !checkClickInSelection(e.clientX, e.clientY)) {
      // Allow browser to handle deselection
      return;
    }

    // Normalize content: ensure all text is wrapped in block elements (p tags)
    if (editorRef.current) {
      const children = Array.from(editorRef.current.childNodes);
      let needsNormalization = false;

      // Check if there are any text nodes or inline elements at the root level
      for (const childNode of children) {
        const child = childNode as Node;
        if (child.nodeType === Node.TEXT_NODE && (child.textContent || '').trim()) {
          needsNormalization = true;
          break;
        }
        if (child.nodeType === Node.ELEMENT_NODE) {
          const elem = child as Element;
          if (!['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'UL', 'OL', 'LI'].includes(elem.tagName)) {
            needsNormalization = true;
            break;
          }
        }
      }

      if (needsNormalization) {
        const fragment = document.createDocumentFragment();
        let currentP: HTMLParagraphElement | null = null;

        for (const child of children) {
          if (child.nodeType === Node.TEXT_NODE ||
            (child.nodeType === Node.ELEMENT_NODE &&
              !['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'UL', 'OL'].includes((child as Element).tagName))) {
            // Wrap in a paragraph
            if (!currentP) {
              currentP = document.createElement('p');
              currentP.style.lineHeight = '1.5';
              fragment.appendChild(currentP);
            }
            currentP.appendChild(child.cloneNode(true));
          } else {
            // Block element - add as is
            currentP = null;
            const blockElem = child.cloneNode(true) as HTMLElement;
            if (!blockElem.style.lineHeight) {
              blockElem.style.lineHeight = '1.5';
            }
            fragment.appendChild(blockElem);
          }
        }

        // Save cursor position
        const savedSelection = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;

        editorRef.current.innerHTML = '';
        editorRef.current.appendChild(fragment);

        // Restore cursor position if possible
        if (savedSelection && selection) {
          try {
            selection.removeAllRanges();
            selection.addRange(savedSelection);
          } catch (e) {
            // If restoration fails, place cursor at end
            const range = document.createRange();
            range.selectNodeContents(editorRef.current);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      }
    }
  };


  // Helper to ensure edited content is visible
  const claimAiContent = useCallback((startNode: Node) => {
    let currentBlock = startNode.nodeType === Node.ELEMENT_NODE
      ? startNode as HTMLElement
      : startNode.parentElement;

    // Untag the current block (User is editing it)
    while (currentBlock && editorRef.current && editorRef.current.contains(currentBlock) && currentBlock !== editorRef.current) {
      if (currentBlock.getAttribute('data-ai-text') === 'true') {
        currentBlock.removeAttribute('data-ai-text');
        currentBlock.removeAttribute('data-ai-origin');
      }
      currentBlock = currentBlock.parentElement;
    }
  }, []);

  const normalizeAiHighlightSpans = (root: HTMLElement) => {
    const highlightSelector = 'span[data-ai-highlighted="true"]';
    const parents = new Set<HTMLElement>();

    Array.from(root.querySelectorAll(highlightSelector)).forEach((el, index) => {
      const highlightEl = el as HTMLElement;
      if (!(highlightEl.textContent || '').trim()) {
        highlightEl.remove();
        return;
      }
      highlightEl.style.removeProperty('display');
      if (!highlightEl.hasAttribute('data-ai-highlight-variant')) {
        highlightEl.setAttribute('data-ai-highlight-variant', String(index % 4));
      }
      const parent = highlightEl.parentElement;
      if (parent) parents.add(parent);
    });

    const parseTimestamp = (raw?: string | null): number | undefined => {
      if (!raw) return undefined;
      const num = Number(raw);
      if (!Number.isNaN(num) && num > 0) return num;
      const parsed = Date.parse(raw);
      if (!Number.isNaN(parsed)) return parsed;
      return undefined;
    };

    const isHighlightSpan = (node: Node): node is HTMLElement =>
      node.nodeType === Node.ELEMENT_NODE &&
      (node as HTMLElement).getAttribute('data-ai-highlighted') === 'true';

    const getStyleSignature = (el: HTMLElement) => {
      const style = el.style;
      return [
        style.fontFamily,
        style.fontSize,
        style.color,
        style.lineHeight,
        style.display,
      ].join('|');
    };

    parents.forEach((parent) => {
      let i = 0;
      while (i < parent.childNodes.length) {
        const node = parent.childNodes[i];
        if (!isHighlightSpan(node)) {
          i++;
          continue;
        }

        const current = node as HTMLElement;
        const currentStyle = getStyleSignature(current);
        let currentTs = parseTimestamp(current.getAttribute('data-ai-highlighted-at'));

        let j = i + 1;
        while (j < parent.childNodes.length) {
          const next = parent.childNodes[j];

          if (next.nodeType === Node.TEXT_NODE) {
            const text = next.textContent ?? '';
            if (text.length === 0) {
              next.remove();
              continue;
            }
            if (text.trim().length === 0) {
              break;
            }
            break;
          }

          if (isHighlightSpan(next)) {
            const nextStyle = getStyleSignature(next);
            if (nextStyle !== currentStyle) break;

            const nextTs = parseTimestamp(next.getAttribute('data-ai-highlighted-at'));
            if (nextTs && (!currentTs || nextTs > currentTs)) {
              currentTs = nextTs;
            }

            while (next.firstChild) current.appendChild(next.firstChild);
            next.remove();
            if (currentTs) {
              current.setAttribute('data-ai-highlighted-at', String(currentTs));
            }
            continue;
          }

          break;
        }

        i++;
      }
    });
  };

  const getHighlightSpan = (range: Range): HTMLElement | null => {
    const startNode = range.startContainer;
    const startElement = startNode.nodeType === Node.ELEMENT_NODE
      ? startNode as Element
      : startNode.parentElement;
    if (!startElement) return null;
    return startElement.closest('[data-ai-highlighted="true"]') as HTMLElement | null;
  };

  const isAtEndOfHighlight = (range: Range, highlightSpan: HTMLElement): boolean => {
    if (!range.collapsed) return false;
    const endRange = document.createRange();
    endRange.selectNodeContents(highlightSpan);
    endRange.collapse(false);
    return range.compareBoundaryPoints(Range.END_TO_END, endRange) === 0;
  };

  const insertStyledText = (text: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return;
    let range = selection.getRangeAt(0);
    signalFirstInput();

    const tagHumanBlock = (node: Node | null) => {
      const el = node?.nodeType === Node.ELEMENT_NODE
        ? node as HTMLElement
        : node?.parentElement;
      const block = el?.closest('p, div, li, h1, h2, h3, h4, h5, h6, blockquote') as HTMLElement | null;
      if (block) block.setAttribute('data-human-block', 'true');
    };

    const ensureParagraphContainer = () => {
      const block = getClosestBlock(range.startContainer);
      if (!block || block === editorRef.current) {
        const p = document.createElement('p');
        p.style.lineHeight = '1.5';
        p.setAttribute('data-human-block', 'true');
        p.appendChild(document.createElement('br'));
        range.insertNode(p);
        const newRange = document.createRange();
        newRange.setStart(p, 0);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
    };



    claimAiContent(range.commonAncestorContainer);


    // Clear placeholder logic
    if (!useOverlayPlaceholder && hasPlaceholder && editorRef.current) {
      const firstChild = editorRef.current.firstElementChild;
      if (firstChild && firstChild.tagName === 'P') {
        const textContent = firstChild.textContent?.trim();
        const computedStyle = window.getComputedStyle(firstChild);
        const isGray = computedStyle.color === 'rgb(110, 110, 110)' || computedStyle.color === '#6e6e6e';
        if (textContent === placeholderText && isGray) {
          editorRef.current.innerHTML = '';
          const newRange = document.createRange();
          newRange.setStart(editorRef.current, 0);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          range.setStart(editorRef.current, 0);
          range.collapse(true);
        }
      }
    }

    if (!range.collapsed) range.deleteContents();

    ensureParagraphContainer();

    range = selection.getRangeAt(0);

    const collapsedOutput = getCollapsedAiOutputContainer(range.startContainer);
    const highlightSpan = collapsedOutput ? getHighlightSpan(range) : null;
    if (collapsedOutput && highlightSpan) {
      const textNode = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer as Text
        : highlightSpan.firstChild as Text | null;
      if (textNode && highlightSpan.contains(textNode)) {
        const offset = range.startContainer === textNode ? range.startOffset : textNode.length;
        const before = textNode.data.slice(0, offset);
        const after = textNode.data.slice(offset);
        const parent = highlightSpan.parentNode;
        if (parent) {
          if (before) {
            const beforeSpan = highlightSpan.cloneNode(false) as HTMLElement;
            beforeSpan.textContent = before;
            parent.insertBefore(beforeSpan, highlightSpan);
          }
          const humanSpan = createHumanTextSpan(text, '1');
          parent.insertBefore(humanSpan, highlightSpan);
          if (after) {
            const afterSpan = highlightSpan.cloneNode(false) as HTMLElement;
            afterSpan.textContent = after;
            parent.insertBefore(afterSpan, highlightSpan);
          }
          parent.removeChild(highlightSpan);
          range.setStartAfter(humanSpan);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          tagHumanBlock(humanSpan);
          scheduleEditorEmptyUpdate();
          scheduleAutosave();
          queueHistorySnapshot();
          return;
        }
      }
    }

    // If we are inside a text node that belongs to a human span, just insert the text
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const textNode = range.startContainer as Text;
      const parent = textNode.parentElement;
      if (parent && (parent.tagName === 'SPAN' && isHumanTextSpan(parent))) {
        const offset = range.startOffset;
        textNode.insertData(offset, text);
        parent.setAttribute('data-human-updated-at', String(Date.now()));
        range.setStart(textNode, offset + text.length);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        tagHumanBlock(parent);
        scheduleEditorEmptyUpdate();
        scheduleAutosave();
        queueHistorySnapshot();
        return;
      }
    }

    // If we are at the end of a human span (but maybe range.startContainer is the SPAN itself)
    if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
      const element = range.startContainer as HTMLElement;
      if (element.tagName === 'SPAN' && isHumanTextSpan(element)) {
        const textNode = element.firstChild as Text;
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          const offset = range.startOffset;
          textNode.insertData(offset, text);
          element.setAttribute('data-human-updated-at', String(Date.now()));
          range.setStart(textNode, offset + text.length);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          tagHumanBlock(element);
          scheduleEditorEmptyUpdate();
          scheduleAutosave();
          queueHistorySnapshot();
          return;
        }
      }
    }

    // Default: create a new human span
    const span = createHumanTextSpan(text, '1');
    range.insertNode(span);
    range.setStart(span.firstChild!, text.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    tagHumanBlock(span);
    handleEditorInput();
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const ctrlKey = isMac ? e.metaKey : e.ctrlKey;

    if (e.key === 'Backspace' || e.key === 'Delete') {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const toggle = (range.startContainer.nodeType === Node.ELEMENT_NODE
          ? (range.startContainer as HTMLElement)
          : range.startContainer.parentElement
        )?.closest('[data-ai-output-toggle="true"]') as HTMLElement | null;
        if (toggle) {
          e.preventDefault();
          e.stopPropagation();
          const container = toggle.closest('[data-ai-output="true"]') as HTMLElement | null;
          if (container) {
            stripAiFromOutput(container);
          }
          return;
        }
      }
    }

    // Cancel AI review with Escape
    if (e.key === 'Escape' && isLoading) {
      e.preventDefault();
      e.stopPropagation();
      cancelReview();
      return;
    }

    if (ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleAiReview();
      return;
    }

    if (!ctrlKey && !e.metaKey && !e.altKey && e.key === 'Enter') {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const collapsedOutput = getCollapsedAiOutputContainer(range.startContainer);
        if (collapsedOutput) {
          const highlightSpan = getHighlightSpan(range);
          if (highlightSpan) {
            if (isAtEndOfHighlight(range, highlightSpan)) {
              e.preventDefault();
              e.stopPropagation();
              const aiBlock = highlightSpan.closest('[data-ai-origin="true"], [data-ai-text="true"], [data-ai-question="true"]') as HTMLElement | null;
              const target = aiBlock ?? highlightSpan;
              const p = document.createElement('p');
              p.style.lineHeight = '1.5';
              p.appendChild(document.createElement('br'));
              target.parentNode?.insertBefore(p, target.nextSibling);
              const newRange = document.createRange();
              newRange.setStart(p, 0);
              newRange.collapse(true);
              selection.removeAllRanges();
              selection.addRange(newRange);
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            setAiOutputCollapsed(collapsedOutput, false);
            return;
          }
        }
        const block = getClosestBlock(range.startContainer);
        if (block && block.tagName !== 'LI') {
          e.preventDefault();
          e.stopPropagation();
          document.execCommand('insertParagraph');
          const newRange = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
          const newBlock = newRange ? getClosestBlock(newRange.startContainer) : null;
          if (newBlock) newBlock.setAttribute('data-human-block', 'true');
          return;
        }
      }
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      const isPrintable = e.key !== 'Enter' && e.key !== 'Tab' && e.key !== 'Escape';
      if (isPrintable) {
        if (e.key === ' ') {
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (range.collapsed) {
              const block = getClosestBlock(range.startContainer);
              if (block) {
                const trigger = getListTrigger(block, range);
                if (trigger) {
                  e.preventDefault();
                  e.stopPropagation();
                  removeRangeFromBlockStart(block, range);
                  document.execCommand(trigger === 'ordered' ? 'insertOrderedList' : 'insertUnorderedList');
                  return;
                }
              }
            }
          }
        }
        e.preventDefault();
        e.stopPropagation();
        insertStyledText(e.key);
        return;
      }
    }
  };

  const getClosestBlock = (node: Node): HTMLElement | null => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement;
    if (!element) return null;
    return element.closest('p, div, li, h1, h2, h3, h4, h5, h6, blockquote') as HTMLElement | null;
  };

  const getListTrigger = (block: HTMLElement, range: Range): 'unordered' | 'ordered' | null => {
    const probe = range.cloneRange();
    probe.selectNodeContents(block);
    probe.setEnd(range.endContainer, range.endOffset);
    const rawText = (probe.toString() || '').replace(/\u00A0/g, ' ').trim();
    if (rawText === '-' || rawText === '*') return 'unordered';
    if (/^\d+\.$/.test(rawText)) return 'ordered';
    return null;
  };

  const removeRangeFromBlockStart = (block: HTMLElement, range: Range) => {
    const cleanup = range.cloneRange();
    cleanup.selectNodeContents(block);
    cleanup.setEnd(range.endContainer, range.endOffset);
    cleanup.deleteContents();
    const selection = window.getSelection();
    if (selection) {
      const newRange = document.createRange();
      newRange.selectNodeContents(block);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }
  };

  const handleBeforeInput = (e: React.FormEvent<HTMLDivElement>) => {
    const inputEvent = e.nativeEvent as InputEvent;
    if (inputEvent.inputType === 'insertText' || inputEvent.inputType === 'insertCompositionText') {
      const textToInsert = inputEvent.data || '';
      if (!textToInsert) return;
      e.preventDefault();
      insertStyledText(textToInsert);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const selection = window.getSelection();
    if (!selection || !editorRef.current) return;

    const pastedText = e.clipboardData.getData('text/plain');
    if (!pastedText) return;
    signalFirstInput();

    // Get the correct range for insertion
    let range: Range;
    if (selection.rangeCount > 0) {
      const selectedRange = selection.getRangeAt(0);
      if (editorRef.current.contains(selectedRange.commonAncestorContainer)) {
        range = selectedRange;
      } else {
        range = document.createRange();
        range.selectNodeContents(editorRef.current);
        range.collapse(false);
      }
    } else {
      range = document.createRange();
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(range);


    claimAiContent(range.commonAncestorContainer);
    // Clear placeholder logic if we're at the beginning and the placeholder is there
    if (!useOverlayPlaceholder && hasPlaceholder) {
      const firstChild = editorRef.current.firstElementChild;
      if (firstChild && firstChild.tagName === 'P') {
        const textContent = firstChild.textContent?.trim();
        const computedStyle = window.getComputedStyle(firstChild);
        const isGray = computedStyle.color === 'rgb(110, 110, 110)' || computedStyle.color === '#6e6e6e';
        if (textContent === placeholderText && isGray) {
          editorRef.current.innerHTML = '';
          range = document.createRange();
          range.setStart(editorRef.current, 0);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }

    if (!range.collapsed) {
      range.deleteContents();
    }

    const insertParagraphBreak = () => {
      document.execCommand('insertParagraph');
      const currentSelection = window.getSelection();
      if (!currentSelection || currentSelection.rangeCount === 0) return;
      const currentRange = currentSelection.getRangeAt(0);
      const block = getClosestBlock(currentRange.startContainer);
      if (block) block.setAttribute('data-human-block', 'true');
    };

    const lines = pastedText.replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((line: string, index: number) => {
      if (line) insertStyledText(line);
      if (index < lines.length - 1) insertParagraphBreak();
    });

    scheduleEditorEmptyUpdate();
    scheduleAutosave();
    queueHistorySnapshot();
  };

  const handleMarginTextPositionChange = (id: string, x: number, y: number) => {
    setMarginTexts((prev: any[]) => prev.map((m: any) => m.id === id ? { ...m, x, y } : m));
  };

  const handleMarginTextDelete = (id: string) => {
    setMarginTexts((prev: any[]) => prev.filter((m: any) => m.id !== id));
  };

  const handleMarginTextContentChange = (id: string, htmlContent: string) => {
    setMarginTexts((prev: any[]) => prev.map((m: any) => m.id === id ? { ...m, htmlContent } : m));
  };

  const handleMarginTextExpand = (id: string) => {
    const marginText = marginTexts.find((m: any) => m.id === id);
    if (!marginText || !editorRef.current) return;
    editorRef.current.innerHTML = marginText.htmlContent;
    setMarginTexts((prev: any[]) => prev.filter((m: any) => m.id !== id));
    editorRef.current.focus();
    scheduleAutosave();
    queueHistorySnapshot();
  };

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingMargin(true);
    const startX = e.clientX;
    const startWidth = marginWidth;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = marginSide === 'left' ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const newWidth = Math.max(100, Math.min(600, startWidth + delta));
      setMarginWidth(newWidth);
    };
    const handleMouseUpDivider = () => {
      setIsResizingMargin(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUpDivider);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUpDivider);
  };

  const handleSwitchMarginSide = () => {
    if (marginSide) {
      setMarginSide(marginSide === 'left' ? 'right' : 'left');
    }
  };

  const hasMarginContent = marginTexts.length > 0;

  const shortcuts = [
    { keys: 'Ctrl/Cmd + B', action: 'Bold' },
    { keys: 'Ctrl/Cmd + I', action: 'Italic' },
    { keys: 'Ctrl/Cmd + U', action: 'Underline' },
    { keys: 'Ctrl/Cmd + Z', action: 'Undo' },
    { keys: 'Ctrl/Cmd + Y', action: 'Redo' },
    { keys: 'Ctrl/Cmd + S', action: 'Save' },
    { keys: 'Ctrl/Cmd + A', action: 'Select All' },
    { keys: 'Ctrl/Cmd + C', action: 'Copy' },
    { keys: 'Ctrl/Cmd + V', action: 'Paste' },
    { keys: 'Ctrl/Cmd + X', action: 'Cut' },
    { keys: 'Ctrl/Cmd + /', action: 'Show/Hide Shortcuts' },
    { keys: 'Escape', action: 'Clear Selection' },
  ];

  return (
    <div className="w-full min-h-screen relative">
      {showHeader && (
        <div className="sticky top-0 z-30 bg-white border-b border-gray-200 pl-4 pr-2 py-2">
          <div className="w-full mx-auto flex items-center justify-between text-gray-400">
            <div className="flex items-center gap-1">
              {onHeaderHomeClick ? (
                <button
                  type="button"
                  onClick={onHeaderHomeClick}
                  className="truncate max-w-[220px] cursor-pointer hover:text-gray-600 hover:underline transition-colors"
                  style={AI_TEXT_STYLE}
                  aria-label="Go to Monospace home"
                >
                  Monospace
                </button>
              ) : (
                <span className="truncate max-w-[220px]" style={AI_TEXT_STYLE}>Monospace</span>
              )}
              <span className="text-xs text-gray-300">/</span>
              <span className="truncate max-w-[220px]" style={AI_TEXT_STYLE}>
                {doc.title || 'Untitled'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <select
                id="model-select"
                value={OPENAI_MODEL_OPTIONS.includes(selectedModel) ? selectedModel : OPENAI_MODEL_OPTIONS[0]}
                onChange={handleModelChange}
                className="text-xs border border-gray-200 rounded pl-1 pr-5 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                aria-label="Select AI model"
              >
                {OPENAI_MODEL_OPTIONS.map((modelId) => (<option key={modelId} value={modelId}>{modelId}</option>))}
              </select>

              <button type="button" className="p-1.5 hover:text-gray-700 transition-colors disabled:opacity-50" title="AI Review (Cmd+Enter)" disabled={aiLoading} aria-label="AI Review" onClick={handleAiReview}>
                {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Sparkles className="w-4 h-4" aria-hidden />}
              </button>
            </div>
          </div>
        </div>
      )}

      {showShortcuts && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold">Keyboard Shortcuts</h2>
              <button onClick={() => setShowShortcuts(false)} className="text-gray-500 hover:text-gray-700">?</button>
            </div>
            <div className="space-y-2">
              {shortcuts.map((shortcut, index) => (
                <div key={index} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-b-0">
                  <span className="text-gray-700">{shortcut.action}</span>
                  <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">{shortcut.keys}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {dropCursorPos && dragTarget === 'editor' && (
        <div className="fixed w-0.5 h-5 bg-blue-500 pointer-events-none z-50" style={{ left: `${dropCursorPos.x}px`, top: `${dropCursorPos.y}px` }} />
      )}

      {dragElementPos && draggedContent && (
        <div className={`fixed pointer-events-none z-50 text-white px-2 py-1 rounded text-sm max-w-xs truncate shadow-lg ${isDuplicating ? 'bg-green-500' : 'bg-blue-500'}`} style={{ left: `${dragElementPos.x + 10}px`, top: `${dragElementPos.y + 10}px` }}>
          {isDuplicating && <span className="mr-1">+</span>}{draggedContent}
        </div>
      )}

      {additionalSelections.map((range: Range, index: number) => {
        const rects = (range as Range).getClientRects();
        return (Array.from(rects) as DOMRect[]).map((rect: DOMRect, rectIndex: number) => (
          <div key={`${index}-${rectIndex}`} className="fixed pointer-events-none bg-blue-200/40 z-40" style={{ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }} />
        ));
      })}

      <div ref={containerRef} className="relative max-w-7xl mx-auto flex overflow-hidden" onMouseUp={handleMouseUp} onMouseMove={handleMouseMove}>
        {marginSide === 'left' && (
          <>
            <div className="relative flex-shrink-0 overflow-hidden" style={{ width: `${marginWidth}px`, height: 'calc(100vh - 48px)' }}>
              <button onClick={handleSwitchMarginSide} className="absolute top-2 right-2 z-20 p-1.5 bg-white hover:bg-gray-100 rounded shadow-sm border border-gray-200" title="Switch to right margin">
                <MoveHorizontal className="w-4 h-4 text-gray-600" />
              </button>
              <MarginTextContainer
                texts={marginTexts}
                onPositionChange={handleMarginTextPositionChange}
                onDelete={handleMarginTextDelete}
                onContentChange={handleMarginTextContentChange}
                onExpand={handleMarginTextExpand}
              />
            </div>
            {hasMarginContent && (
              <div className="relative flex-shrink-0 group" onMouseDown={handleDividerMouseDown}>
                <div className="absolute inset-0 w-4 -ml-2 cursor-col-resize z-10" />
                <div className="h-full w-px bg-gray-300 group-hover:bg-gray-500 transition-colors">
                  <div className="w-full h-full bg-gradient-to-b from-transparent via-[#E1E1E1] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            )}
          </>
        )}

        <div
          className="flex-1 min-w-0 overflow-auto"
          style={{ paddingTop: scrollTopPadding, paddingBottom: scrollCenterPadding }}
        >
          <div className="relative max-w-3xl mx-auto">
            {useOverlayPlaceholder && isEditorEmpty && hasPlaceholder && (
              <div className="pointer-events-none absolute inset-0 z-0">
                <div
                  className="p-8 text-[#6e6e6e]"
                  style={{
                    fontFamily: AI_TEXT_STYLE.fontFamily,
                    fontSize: AI_TEXT_STYLE.fontSize,
                    fontWeight: AI_TEXT_STYLE.fontWeight,
                    fontVariationSettings: AI_TEXT_STYLE.fontVariationSettings,
                    lineHeight: '1.5',
                  }}
                >
                  <p className="mt-0.75">{placeholderText}</p>
                </div>
              </div>
            )}
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className={`${editorMinHeightClass} ${editorBackgroundClass} relative z-10 p-8 focus:outline-none prose prose-lg font-normal [&_p]:my-3 [&_p]:min-h-[1.5em] [&_p[data-ai-output-toggle='true']]:my-0 [&_p[data-ai-output-spacer='true']]:my-0 whitespace-pre-wrap transition-[min-height] duration-300`}
              spellCheck
              onMouseDown={handleMouseDown}
              onClick={handleClick}
              onKeyDown={handleEditorKeyDown}
              onBeforeInput={handleBeforeInput}
              onPaste={handlePaste}
              onInput={handleEditorInput}
            >
              {!useOverlayPlaceholder && hasPlaceholder && isEditorEmpty && (
                <p
                  className="text-[#6e6e6e]"
                  style={{
                    fontFamily: AI_TEXT_STYLE.fontFamily,
                    fontSize: AI_TEXT_STYLE.fontSize,
                    fontWeight: AI_TEXT_STYLE.fontWeight,
                    fontVariationSettings: AI_TEXT_STYLE.fontVariationSettings,
                    lineHeight: '1.5',
                  }}
                >
                  {placeholderText}
                </p>
              )}
            </div>
          </div>
        </div>

        {marginSide === 'right' && (
          <>
            {hasMarginContent && (
              <div className="relative flex-shrink-0 group" onMouseDown={handleDividerMouseDown}>
                <div className="absolute inset-0 w-4 -ml-2 cursor-col-resize z-10" />
                <div className="h-full w-px bg-gray-300 group-hover:bg-gray-500 transition-colors">
                  <div className="w-full h-full bg-gradient-to-b from-transparent via-[#E1E1E1] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            )}
            <div className="relative flex-shrink-0 overflow-hidden" style={{ width: `${marginWidth}px`, height: 'calc(100vh - 48px)' }}>
              <button onClick={handleSwitchMarginSide} className="absolute top-2 left-2 z-20 p-1.5 bg-white hover:bg-gray-100 rounded shadow-sm border border-gray-200" title="Switch to left margin">
                <MoveHorizontal className="w-4 h-4 text-gray-600" />
              </button>
              <MarginTextContainer
                texts={marginTexts}
                onPositionChange={handleMarginTextPositionChange}
                onDelete={handleMarginTextDelete}
                onContentChange={handleMarginTextContentChange}
                onExpand={handleMarginTextExpand}
              />
            </div>
          </>
        )}
      </div>

      {footer && (
        <div className="max-w-3xl mx-auto px-8 pb-16">
          {footer}
        </div>
      )}

      <style dangerouslySetInnerHTML={{
        __html: `
          [data-ai-highlighted="true"] {
            color: #000;
            position: relative;
            z-index: 0;
            padding: 0;
            border-radius: 2px;
            transition: filter 0.2s ease;
          }

          [data-ai-highlighted="true"]::before {
            content: '';
            position: absolute;
            left: -0.05em;
            right: -0.05em;
            top: -0.34em;
            bottom: -0.08em;
            z-index: -1;
            pointer-events: none;
            background: linear-gradient(180deg, #fff8ab 0%, #fff29a 100%);
            border-radius: 24% 28% 22% 26% / 17% 15% 19% 16%;
            transform: rotate(-0.08deg);
            clip-path: polygon(
              0% 18%,
              18% 15%,
              38% 17%,
              60% 14%,
              82% 16%,
              100% 18%,
              100% 84%,
              82% 87%,
              60% 85%,
              38% 88%,
              18% 86%,
              0% 84%
            );
          }

          [data-ai-highlighted="true"][data-ai-highlight-variant="1"]::before {
            transform: rotate(0.12deg);
            clip-path: polygon(
              0% 17%,
              20% 14%,
              42% 16%,
              64% 13%,
              84% 15%,
              100% 17%,
              100% 85%,
              82% 88%,
              62% 86%,
              40% 89%,
              20% 87%,
              0% 85%
            );
          }

          [data-ai-highlighted="true"]:empty::before {
            content: none;
          }

          [data-ai-highlighted="true"][data-ai-highlight-variant="2"]::before {
            transform: rotate(-0.14deg);
            clip-path: polygon(
              0% 19%,
              16% 16%,
              36% 18%,
              58% 15%,
              80% 17%,
              100% 19%,
              100% 83%,
              84% 86%,
              62% 84%,
              40% 87%,
              18% 85%,
              0% 83%
            );
          }

          [data-ai-highlighted="true"][data-ai-highlight-variant="3"]::before {
            transform: rotate(0.06deg);
            clip-path: polygon(
              0% 18%,
              22% 15%,
              44% 17%,
              66% 14%,
              86% 16%,
              100% 18%,
              100% 84%,
              86% 87%,
              64% 85%,
              42% 88%,
              22% 86%,
              0% 84%
            );
          }
        `
      }} />

      <style dangerouslySetInnerHTML={{
        __html: `
          [data-human-block="true"] {
            margin: 0 0 0.75rem 0 !important;
          }

          [data-ai-hidden="true"] {
            display: none;
          }

          [data-ai-contains-highlight="true"] {
            display: contents;
          }

          [data-ai-highlighted="true"] {
            display: inline;
            visibility: visible;
          }

          [data-ai-show-highlight="true"] {
            display: block !important;
            visibility: hidden;
            margin-bottom: 0;
          }

          [data-ai-show-highlight="true"] [data-ai-highlighted="true"] {
            visibility: visible;
            display: block !important;
            width: fit-content;
            max-width: 100%;
            margin: 0 0 0.28rem 0;
            white-space: normal;
            overflow: visible;
          }

          [data-ai-show-highlight="true"] [data-human-text="true"] {
            visibility: visible;
            display: inline;
          }

          [data-ai-output="true"][data-ai-output-collapsed="true"] [data-ai-output-body="true"] [data-ai-highlighted="true"] {
            display: block !important;
            width: fit-content;
            max-width: 100%;
            margin: 0 0 0.28rem 0;
            white-space: normal;
            overflow: visible;
          }

          [data-ai-output="true"][data-ai-output-collapsed="true"] [data-ai-output-body="true"] [data-human-text="true"] {
            display: inline;
          }

          [data-ai-output="true"][data-ai-output-collapsed="true"] [data-ai-output-body="true"] p {
            margin: 0 0 0.75rem 0;
          }

          [data-ai-output="true"][data-ai-output-collapsed="true"] [data-ai-output-body="true"] p[data-ai-output-toggle="true"],
          [data-ai-output="true"][data-ai-output-collapsed="true"] [data-ai-output-body="true"] p[data-ai-output-spacer="true"] {
            margin: 0;
          }

          [data-ai-output="true"][data-ai-output-collapsed="true"] [data-ai-output-body="true"] p[data-ai-contains-highlight="true"] {
            display: block;
          }

          [data-ai-highlight-clone="true"] {
            display: block;
            font-family: inherit;
            font-size: inherit;
            line-height: 1.5;
            color: inherit;
            margin-top: 0.25rem;
          }
        `
      }} />
    </div>
  );
}
