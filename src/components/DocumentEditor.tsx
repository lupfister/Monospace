import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  MoveHorizontal,
  Sparkles,
  Loader2,
  Eye,
  EyeOff
} from 'lucide-react';
import { createHumanTextSpan, isHumanTextSpan, createStyledSourceLink, isAiTextSpan } from '../lib/textStyles';
import { isProbablyUrl } from '../lib/linkPreviews';

import { useLinkHydrator } from '../hooks/useLinkHydrator';
import { useSearchAgent } from '../hooks/useSearchAgent';
import { MarginTextContainer, MarginTextData } from './MarginTextContainer';
import { OPENAI_MODEL_OPTIONS } from '../lib/openaiAgentApi';
import { LineHeightHandle } from './LineHeightHandle';


export function DocumentEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Line height handle state
  const [lineHeightHandlePos, setLineHeightHandlePos] = useState<{ top: number; left: number; height: number } | null>(null);
  const [isDraggingLineHeight, setIsDraggingLineHeight] = useState(false);
  const [currentBlock, setCurrentBlock] = useState<HTMLElement | null>(null);
  const lineHeightDragStart = useRef<{ y: number; initialHeight: number } | null>(null);

  const [selectedModel, setSelectedModel] = useState('gpt-4o-mini');
  const [showAiText, setShowAiText] = useState(true);
  const { handleAiReview, cancelReview, isLoading, aiLoading, aiError, isSearching, setAiError } = useSearchAgent(editorRef, selectedModel, hydrateSearchResultImages);

  const isBusy = isLoading;

  const refreshHiddenAi = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;

    if (showAiText) {
      root.querySelectorAll('[data-ai-hidden="true"]').forEach((el) => {
        (el as HTMLElement).removeAttribute('data-ai-hidden');
      });
      root.querySelectorAll('[data-ai-contains-highlight="true"]').forEach((el) => {
        (el as HTMLElement).removeAttribute('data-ai-contains-highlight');
      });
      return;
    }

    root.querySelectorAll('[data-ai-hidden="true"]').forEach((el) => {
      (el as HTMLElement).removeAttribute('data-ai-hidden');
    });
    root.querySelectorAll('[data-ai-contains-highlight="true"]').forEach((el) => {
      (el as HTMLElement).removeAttribute('data-ai-contains-highlight');
    });
    root.querySelectorAll('[data-ai-show-highlight="true"]').forEach((el) => {
      (el as HTMLElement).removeAttribute('data-ai-show-highlight');
    });
    root.querySelectorAll('[data-ai-highlight-clone="true"]').forEach((clone) => {
      clone.remove();
    });

    const aiNodes = new Set<HTMLElement>();
    root.querySelectorAll('[data-ai-text="true"], [data-ai-question="true"], [data-ai-origin="true"], span[role="link"]').forEach((el) => {
      aiNodes.add(el as HTMLElement);
    });
    root.querySelectorAll('span').forEach((span) => {
      const el = span as HTMLElement;
      if (isAiTextSpan(el)) {
        aiNodes.add(el);
      }
    });

    aiNodes.forEach((el) => {
      if (el !== root) {
        el.setAttribute('data-ai-hidden', 'true');
      }
    });

    const wrapAiTextNodes = (container: HTMLElement) => {
      Array.from(container.childNodes).forEach((node) => {
        if (node.nodeType !== Node.TEXT_NODE) return;
        const text = node.textContent || '';
        if (!text.trim()) return;
        if ((node as Text).parentElement?.closest('[data-ai-highlighted="true"]')) return;
        const span = document.createElement('span');
        span.setAttribute('data-ai-text', 'true');
        span.setAttribute('data-ai-hidden', 'true');
        span.textContent = text;
        node.parentNode?.insertBefore(span, node);
        node.parentNode?.removeChild(node);
      });
    };

    root.querySelectorAll('[data-ai-origin="true"], [data-ai-text="true"], [data-ai-question="true"]').forEach((el) => {
      wrapAiTextNodes(el as HTMLElement);
    });

    root.querySelectorAll('[data-ai-text="true"]:not([data-ai-highlighted="true"])').forEach((el) => {
      (el as HTMLElement).setAttribute('data-ai-hidden', 'true');
    });

    const highlightParents = new Set<HTMLElement>();
    root.querySelectorAll('[data-ai-highlighted="true"]').forEach((el) => {
      (el as HTMLElement).removeAttribute('data-ai-hidden');
      let node: HTMLElement | null = el as HTMLElement;
      while (node && node !== root) {
        if (node.getAttribute('data-ai-hidden') === 'true') {
          node.setAttribute('data-ai-contains-highlight', 'true');
        }
        node = node.parentElement;
      }
      const block = (el as HTMLElement).closest('[data-ai-origin="true"], [data-ai-text="true"], [data-ai-question="true"]') as HTMLElement | null;
      if (block) {
        highlightParents.add(block);
      }
    });

    const highlightSpans = Array.from(root.querySelectorAll('[data-ai-highlighted="true"]')) as HTMLElement[];
    highlightSpans.forEach((el) => {
      const block = el.closest('[data-ai-origin="true"], [data-ai-text="true"], [data-ai-question="true"]') as HTMLElement | null;
      if (block) highlightParents.add(block);
    });



    highlightParents.forEach((block) => {
      block.removeAttribute('data-ai-hidden');
      block.setAttribute('data-ai-show-highlight', 'true');
    });
  }, [showAiText]);

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
      if (!showAiText) {
        refreshHiddenAi();
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [showAiText, refreshHiddenAi]);

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

  // Load saved content on mount
  useEffect(() => {
    const savedContent = localStorage.getItem('documentContent');
    if (savedContent && editorRef.current) {
      editorRef.current.innerHTML = savedContent;
      requestAnimationFrame(() => {
        hydrateSearchResultImages(editorRef.current);
        normalizeContent();

        // Tag existing AI text
        if (editorRef.current) {
          editorRef.current.querySelectorAll('[data-ai-text="true"]').forEach((el) => {
            (el as HTMLElement).setAttribute('data-ai-origin', 'true');
          });

          const spans = editorRef.current.querySelectorAll('span');
          spans.forEach((span: HTMLSpanElement) => {
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
        }
      });
    }
  }, [hydrateSearchResultImages, normalizeContent]);

  useEffect(() => {
    refreshHiddenAi();
  }, [refreshHiddenAi]);

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
        handleSave();
      }

      if (ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        document.execCommand('undo');
      }

      if ((ctrlKey && e.key === 'y') || (ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        document.execCommand('redo');
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

  const handleFormat = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };



  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(event.target.value);
  };

  const handleSave = () => {
    if (editorRef.current) {
      const content = editorRef.current.innerHTML;
      localStorage.setItem('documentContent', content);

      const notification = document.createElement('div');
      notification.textContent = 'Document saved!';
      notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
      document.body.appendChild(notification);
      setTimeout(() => notification.remove(), 2000);
    }
  };

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

                const style = window.getComputedStyle(cp);
                span.style.fontFamily = style.fontFamily;
                span.style.fontSize = style.fontSize;
                span.style.color = style.color;
                span.style.lineHeight = style.lineHeight;
                span.style.display = 'inline';
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
            selection.removeAllRanges();
          }
        }
      }
    }
  };

  const handleClick = (e: React.MouseEvent) => {
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

  const ensureVisibleInsertionPoint = useCallback((range: Range) => {
    if (showAiText) return;

    const startNode = range.startContainer;
    const startElement = startNode.nodeType === Node.ELEMENT_NODE
      ? startNode as Element
      : startNode.parentElement;
    if (!startElement) return;

    const aiContainer = startElement.closest('[data-ai-origin="true"]') as HTMLElement | null;
    if (!aiContainer) return;

    if (
      aiContainer.tagName === 'SPAN' &&
      aiContainer.childNodes.length === 1 &&
      aiContainer.firstChild?.nodeType === Node.TEXT_NODE &&
      range.startContainer.nodeType === Node.TEXT_NODE
    ) {
      const textNode = aiContainer.firstChild as Text;
      const offset = range.startOffset;
      const text = textNode.data || '';
      const beforeText = text.slice(0, offset);
      const afterText = text.slice(offset);

      const parent = aiContainer.parentNode;
      if (!parent) return;

      const beforeSpan = beforeText ? (aiContainer.cloneNode(false) as HTMLElement) : null;
      const afterSpan = afterText ? (aiContainer.cloneNode(false) as HTMLElement) : null;

      if (beforeSpan) {
        beforeSpan.appendChild(document.createTextNode(beforeText));
        parent.insertBefore(beforeSpan, aiContainer);
      }
      if (afterSpan) {
        afterSpan.appendChild(document.createTextNode(afterText));
        parent.insertBefore(afterSpan, aiContainer.nextSibling);
      }

      parent.removeChild(aiContainer);

      if (beforeSpan) {
        range.setStartAfter(beforeSpan);
      } else if (afterSpan) {
        range.setStartBefore(afterSpan);
      } else {
        range.setStart(parent, parent.childNodes.length);
      }
      range.collapse(true);
      return;
    }

    range.setStartAfter(aiContainer);
    range.collapse(true);
  }, [showAiText]);

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
    const range = selection.getRangeAt(0);



    claimAiContent(range.commonAncestorContainer);


    // Clear placeholder logic
    if (editorRef.current) {
      const firstChild = editorRef.current.firstElementChild;
      if (firstChild && firstChild.tagName === 'P') {
        const textContent = firstChild.textContent?.trim();
        const computedStyle = window.getComputedStyle(firstChild);
        const isGray = computedStyle.color === 'rgb(110, 110, 110)' || computedStyle.color === '#6e6e6e';
        if (textContent === 'Start writing...' && isGray) {
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

    const highlightSpan = !showAiText ? getHighlightSpan(range) : null;
    if (!showAiText && highlightSpan) {
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
        range.setStart(textNode, offset + text.length);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
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
          range.setStart(textNode, offset + text.length);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
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
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const ctrlKey = isMac ? e.metaKey : e.ctrlKey;

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

    if (!ctrlKey && !e.metaKey && !e.altKey && e.key === 'Enter' && !showAiText) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
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
          setShowAiText(true);
          return;
        }
      }
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      const isPrintable = e.key !== 'Enter' && e.key !== 'Tab' && e.key !== 'Escape';
      if (isPrintable) {
        e.preventDefault();
        e.stopPropagation();
        insertStyledText(e.key);
        return;
      }
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


    claimAiContent(range.commonAncestorContainer);
    // Clear placeholder logic if we're at the beginning and the placeholder is there
    const firstChild = editorRef.current.firstElementChild;
    if (firstChild && firstChild.tagName === 'P') {
      const textContent = firstChild.textContent?.trim();
      const computedStyle = window.getComputedStyle(firstChild);
      const isGray = computedStyle.color === 'rgb(110, 110, 110)' || computedStyle.color === '#6e6e6e';
      if (textContent === 'Start writing...' && isGray) {
        editorRef.current.innerHTML = '';
        range = document.createRange();
        range.setStart(editorRef.current, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    if (!range.collapsed) {
      range.deleteContents();
    }

    const trimmed = pastedText.trim();
    if (isProbablyUrl(trimmed)) {
      const linkPill = createStyledSourceLink(trimmed, trimmed);
      // Ensure vertical alignment and spacing
      linkPill.style.marginLeft = '4px';
      linkPill.style.marginRight = '4px';
      range.insertNode(linkPill);

      const newRange = document.createRange();
      newRange.setStartAfter(linkPill);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
      return;
    }

    const span = createHumanTextSpan('', '1');
    const lines = pastedText.split('\n');
    lines.forEach((line: string, index: number) => {
      if (index > 0) span.appendChild(document.createElement('br'));
      if (line) span.appendChild(document.createTextNode(line));
    });
    range.insertNode(span);
    range.setStartAfter(span);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
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
    <div className="w-full min-h-screen">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-2 py-2">
        <div className="w-full mx-auto flex gap-0.5 items-center text-gray-400">
          <button onClick={() => handleFormat('bold')} className="p-1.5 hover:text-gray-700 transition-colors" title="Bold (Ctrl/Cmd+B)"><Bold className="w-4 h-4" /></button>
          <button onClick={() => handleFormat('italic')} className="p-1.5 hover:text-gray-700 transition-colors" title="Italic (Ctrl/Cmd+I)"><Italic className="w-4 h-4" /></button>
          <button onClick={() => handleFormat('underline')} className="p-1.5 hover:text-gray-700 transition-colors" title="Underline (Ctrl/Cmd+U)"><Underline className="w-4 h-4" /></button>
          <div className="w-3" />
          <button onClick={() => handleFormat('insertUnorderedList')} className="p-1.5 hover:text-gray-700 transition-colors" title="Bullet List"><List className="w-4 h-4" style={{ transform: 'scale(1.1)' }} /></button>
          <button onClick={() => handleFormat('insertOrderedList')} className="p-1.5 hover:text-gray-700 transition-colors" title="Numbered List"><ListOrdered className="w-4 h-4" style={{ transform: 'scale(1.1)' }} /></button>
          <button onClick={() => handleFormat('insertOrderedList')} className="p-1.5 hover:text-gray-700 transition-colors" title="Numbered List"><ListOrdered className="w-4 h-4" style={{ transform: 'scale(1.1)' }} /></button>
          <div className="w-3" />

          <button
            onClick={() => setShowAiText((prev: boolean) => !prev)}
            className={`p-1.5 hover:text-gray-700 transition-colors ${!showAiText ? 'text-gray-700 bg-gray-100 rounded' : ''}`}
            title={showAiText ? "Hide AI Text" : "Show AI Text"}
          >
            {showAiText ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
          <div className="w-3" />

          <button type="button" className="p-1.5 hover:text-gray-700 transition-colors disabled:opacity-50" title="AI Review (Cmd+Enter)" disabled={aiLoading} aria-label="AI Review" onClick={handleAiReview}>
            {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Sparkles className="w-4 h-4" aria-hidden />}
          </button>
          <div className="ml-2 flex items-center gap-2">
            <label htmlFor="model-select" className="text-xs text-gray-500">Model</label>
            <select id="model-select" value={OPENAI_MODEL_OPTIONS.includes(selectedModel) ? selectedModel : OPENAI_MODEL_OPTIONS[0]} onChange={handleModelChange} className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2" aria-label="Select AI model">
              {OPENAI_MODEL_OPTIONS.map((modelId) => (<option key={modelId} value={modelId}>{modelId}</option>))}
            </select>
          </div>

        </div>
      </div>

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

        <div className="flex-1 min-w-0 overflow-auto">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            className="min-h-screen bg-white p-8 focus:outline-none prose prose-lg max-w-3xl mx-auto font-normal [&_p]:my-0 [&_p]:min-h-[1.5em] whitespace-pre-wrap"
            spellCheck
            onMouseDown={handleMouseDown}
            onClick={handleClick}
            onKeyDown={handleEditorKeyDown}
            onBeforeInput={handleBeforeInput}
            onPaste={handlePaste}
          >
            <p className="text-[#6e6e6e]" style={{ fontFamily: 'Inter, sans-serif', fontSize: '18px', fontWeight: 350, fontVariationSettings: '"wght" 350' }}>Start writing...</p>
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

      <style dangerouslySetInnerHTML={{
        __html: `
          [data-ai-highlighted="true"] {
            background-color: #fff7a5;
            color: #000;
            padding: 1px 0;
            border-radius: 2px;
            transition: background-color 0.2s ease;
          }
        `
      }} />

      {!showAiText && (
        <style dangerouslySetInnerHTML={{
          __html: `
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
            }

            [data-ai-show-highlight="true"] [data-ai-highlighted="true"] {
              visibility: visible;
              display: inline;
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
      )}

      <LineHeightHandle editorRef={editorRef} />
    </div>
  );
}
