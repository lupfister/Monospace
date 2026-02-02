import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  Bold, 
  Italic, 
  Underline, 
  List,
  ListOrdered,
  MoveHorizontal,
  Sparkles,
  Loader2
} from 'lucide-react';
import { MarginText } from './MarginText';
import Vector59 from '../imports/Vector59';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import {
  AgentSearchRequest,
  AgentSearchResult,
  generateWithGemini,
  searchWithAgent,
  type GeminiAction,
  type GeminiSearchType,
  planSearchWithGemini,
} from '../lib/openaiAgentApi';
import { createHumanTextSpan, createAiTextSpan, createAiTextWithLinksFragment, isHumanTextSpan } from '../lib/textStyles';
import { getLinkPreview, isProbablyUrl, type LinkPreviewData } from '../lib/linkPreviews';
import {
  orderedSearchResultsToItems,
  resultCardClasses,
  type ResultItem,
  type ResultItemType,
} from '../lib/searchResultItems';

/**
 * OpenAI model IDs that support the Agents API and hosted web search
 * (GPT-4o and GPT-4.1 series). Ordered by price ascending (cheapest first).
 * Rough per-1M tokens: 4o-mini $0.15/$0.60, 4.1-mini $0.80/$3.20, 4.1 $2/$8.
 */
const OPENAI_MODEL_OPTIONS: readonly string[] = [
  'gpt-4o-mini',
  'gpt-4.1-mini',
  'gpt-4.1',
];

export function DocumentEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const linkPreviewInFlight = useRef<Set<string>>(new Set());
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedContent, setDraggedContent] = useState('');
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [dropCursorPos, setDropCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [dragElementPos, setDragElementPos] = useState<{ x: number; y: number } | null>(null);
  const draggedFragment = useRef<DocumentFragment | null>(null);
  const [marginTexts, setMarginTexts] = useState<{
    id: string;
    content: string;
    htmlContent: string;
    x: number;
    y: number;
  }[]>([]);
  const [dragTarget, setDragTarget] = useState<'editor' | 'left-margin' | 'right-margin' | null>(null);
  const [marginWidth, setMarginWidth] = useState(256);
  const [marginSide, setMarginSide] = useState<'left' | 'right' | null>(null);
  const [isResizingMargin, setIsResizingMargin] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [additionalSelections, setAdditionalSelections] = useState<Range[]>([]);
  const [isShiftSelecting, setIsShiftSelecting] = useState(false);
  const shiftSelectStart = useRef<{ x: number; y: number } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const savedSelection = useRef<Range | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gpt-4o-mini');
  const isBusy = aiLoading || isSearching;

  // Auto-set margin side when there are texts
  useEffect(() => {
    if (marginTexts.length > 0 && marginSide === null) {
      // Determine side based on first text position or default to left
      setMarginSide('left');
    } else if (marginTexts.length === 0) {
      setMarginSide(null);
    }
  }, [marginTexts, marginSide]);

  const createLinkAnchor = useCallback((url: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className =
      'text-blue-600 underline underline-offset-2 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-sm';
    a.textContent = url;
    a.tabIndex = 0;
    a.setAttribute('aria-label', `Open link: ${url}`);
    a.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      window.open(url, '_blank', 'noopener,noreferrer');
    });
    return a;
  }, []);

  const buildLinkPreviewCard = useCallback((url: string) => {
    const wrapper = document.createElement('div');
    wrapper.dataset.embed = 'link-preview';
    wrapper.dataset.url = url;
    wrapper.contentEditable = 'false';
    wrapper.className =
      // NOTE: this project ships a pre-generated Tailwind CSS subset (no tailwind.config),
      // so we only use utility classes that are confirmed to exist in `src/index.css`.
      'w-full max-w-3xl mx-auto rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden';

    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'block hover:bg-gray-100 transition-colors';
    link.tabIndex = 0;

    const container = document.createElement('div');
    container.className = 'flex';

    // Image slot (only shown if we successfully load an image)
    const imageWrapper = document.createElement('div');
    imageWrapper.dataset.part = 'image-wrapper';
    imageWrapper.className = 'bg-gray-100 flex-shrink-0 overflow-hidden';
    // Use minimal inline size because many size utilities aren't present in the prebuilt CSS.
    imageWrapper.style.width = '96px';
    imageWrapper.style.height = '96px';

    const imagePlaceholder = document.createElement('div');
    imagePlaceholder.dataset.part = 'image-placeholder';
    imagePlaceholder.className = 'w-full h-full';
    imageWrapper.appendChild(imagePlaceholder);

    // Content section (right side on desktop)
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'flex-1 p-4 flex flex-col justify-between min-w-0';

    const textContent = document.createElement('div');
    textContent.className = 'flex-1';

    const title = document.createElement('div');
    title.dataset.part = 'title';
    title.className = 'h-5 w-3/5 rounded-lg bg-gray-200';
    title.setAttribute('aria-hidden', 'true');

    const desc = document.createElement('div');
    desc.dataset.part = 'description';
    desc.className = 'h-4 w-4/5 rounded-lg bg-gray-100';
    desc.setAttribute('aria-hidden', 'true');

    const urlRow = document.createElement('div');
    urlRow.dataset.part = 'url';
    urlRow.className = 'pt-1';
    
    const urlText = document.createElement('div');
    urlText.className = 'text-sm text-gray-500 truncate';
    
    const urlSpan = document.createElement('span');
    urlSpan.textContent = url;
    urlText.appendChild(urlSpan);
    urlRow.appendChild(urlText);

    textContent.appendChild(title);
    textContent.appendChild(desc);
    contentWrapper.appendChild(textContent);
    contentWrapper.appendChild(urlRow);

    // Image (left) + content (right)
    container.appendChild(imageWrapper);
    container.appendChild(contentWrapper);
    link.appendChild(container);
    wrapper.appendChild(link);

    return wrapper;
  }, []);

  const hydrateLinkPreviewCard = useCallback(async (card: HTMLElement, url: string) => {
    if (linkPreviewInFlight.current.has(url)) return;
    linkPreviewInFlight.current.add(url);
    try {
      const data = await getLinkPreview(url);
      if (!data) {
        // If fetch failed, show a simple link card
        const titleEl = card.querySelector<HTMLElement>('[data-part="title"]');
        if (titleEl) {
          titleEl.className = 'text-base font-semibold text-gray-900';
          titleEl.textContent = url;
          titleEl.removeAttribute('aria-hidden');
        }
        const descEl = card.querySelector<HTMLElement>('[data-part="description"]');
        if (descEl) descEl.remove();
        return;
      }
      
      if (card.dataset.embed !== 'link-preview') return;
      if (card.dataset.url !== url) return;

      const titleEl = card.querySelector<HTMLElement>('[data-part="title"]');
      const descEl = card.querySelector<HTMLElement>('[data-part="description"]');
      const urlEl = card.querySelector<HTMLElement>('[data-part="url"]');
      const imageWrapper = card.querySelector<HTMLElement>('[data-part="image-wrapper"]');
      const imagePlaceholder = card.querySelector<HTMLElement>('[data-part="image-placeholder"]');

      const effectiveTitle = (data.title || data.siteName || url).trim();
      const effectiveDescription = (data.description || '').trim();

      // Update title
      if (titleEl) {
        titleEl.className = 'text-sm font-semibold truncate';
        titleEl.textContent = effectiveTitle;
        titleEl.removeAttribute('aria-hidden');
      }

      // Update description
      if (descEl) {
        if (effectiveDescription) {
          descEl.className = 'text-sm text-gray-600';
          descEl.textContent = effectiveDescription;
          descEl.removeAttribute('aria-hidden');
        } else {
          descEl.remove();
        }
      }

      // Update URL display
      if (urlEl) {
        const urlText = urlEl.querySelector('span:last-child');
        if (urlText) {
          try {
            const u = new URL(url);
            const displayText = data.siteName 
              ? `${data.siteName} · ${u.hostname.replace('www.', '')}`
              : u.hostname.replace('www.', '');
            urlText.textContent = displayText;
          } catch {
            urlText.textContent = url;
          }
        }
      }

      // Update image (only if og/twitter image exists)
      if (imageWrapper && imagePlaceholder) {
        if (!data.imageUrl) {
          imageWrapper.remove();
          return;
        }

        const img = document.createElement('img');
        img.src = data.imageUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.className = 'w-full h-full';
        img.style.objectFit = 'cover';
        img.onerror = () => {
          imageWrapper.remove();
        };
        img.onload = () => {
          imagePlaceholder.replaceWith(img);
        };
      }
    } catch (error) {
      console.error('Failed to hydrate link preview:', error);
      // Show fallback
      const titleEl = card.querySelector<HTMLElement>('[data-part="title"]');
      if (titleEl) {
        titleEl.className = 'text-base font-semibold text-gray-900';
        titleEl.textContent = url;
        titleEl.removeAttribute('aria-hidden');
      }
      const descEl = card.querySelector<HTMLElement>('[data-part="description"]');
      if (descEl) descEl.remove();
    } finally {
      linkPreviewInFlight.current.delete(url);
    }
  }, []);

  const processLinksAndEmbeds = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;

    // 1) Convert raw URLs inside text nodes into anchors (skip inside existing anchors and embed cards)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = (node as Text).parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('a')) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[data-embed="link-preview"]')) return NodeFilter.FILTER_REJECT;
        if (!(node.textContent || '').includes('http')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const urlRegex = /(https?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?])/g;
    const textNodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      textNodes.push(n as Text);
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent || '';
      if (!urlRegex.test(text)) continue;
      urlRegex.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = urlRegex.exec(text))) {
        const start = match.index;
        const end = start + match[0].length;
        const url = match[0];

        if (start > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
        }
        frag.appendChild(createLinkAnchor(url));
        lastIndex = end;
      }

      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      textNode.parentNode?.replaceChild(frag, textNode);
    }

    const replaceWithCard = (target: Node, url: string) => {
      const card = buildLinkPreviewCard(url);
      const block = document.createElement('div');
      block.appendChild(card);
      const spacer = document.createElement('p');
      spacer.appendChild(document.createElement('br'));
      block.appendChild(spacer);

      if (target.parentNode) {
        target.parentNode.replaceChild(block, target);
      } else {
        root.appendChild(block);
      }

      hydrateLinkPreviewCard(card, url);
    };

    // 2a) Handle editors that contain plain spans/text (no <p> wrappers)
    const rootText = (root.textContent || '').trim();
    if (isProbablyUrl(rootText)) {
      const meaningfulRootChildren = (Array.from(root.childNodes) as ChildNode[]).filter((cn) => {
        if (cn.nodeType === Node.TEXT_NODE) return ((cn as Text).textContent || '').trim().length > 0;
        if (cn.nodeType === Node.ELEMENT_NODE) return true;
        return false;
      });

      // Replace only when it's basically "just the URL"
      if (meaningfulRootChildren.length === 1) {
        const onlyChild = meaningfulRootChildren[0];
        if (!(onlyChild as Element)?.closest?.('[data-embed="link-preview"]')) {
          replaceWithCard(onlyChild, rootText);
        }
      }
    }

    // 2b) If a paragraph/div/li is ONLY a single URL, replace it with a preview card
    const blocks = root.querySelectorAll<HTMLElement>('p, div, li, blockquote');
    blocks.forEach((block) => {
      if (block === root) return;
      if (block.closest('[data-embed="link-preview"]')) return;
      if (block.querySelector('[data-embed="link-preview"]')) return;

      const text = (block.textContent || '').trim();
      if (!isProbablyUrl(text)) return;

      // Avoid replacing blocks that contain more than just the URL (e.g. extra nodes)
      const meaningfulChildren = (Array.from(block.childNodes) as ChildNode[]).filter((cn) => {
        if (cn.nodeType === Node.TEXT_NODE) return ((cn as Text).textContent || '').trim().length > 0;
        if (cn.nodeType === Node.ELEMENT_NODE) return true;
        return false;
      });

      if (meaningfulChildren.length > 2) return;

      replaceWithCard(block, text);
    });

    // 3) Hydrate any existing cards that haven’t loaded yet
    const cards = root.querySelectorAll<HTMLElement>('[data-embed="link-preview"][data-url]');
    cards.forEach((card) => {
      const url = card.dataset.url;
      if (!url) return;
      hydrateLinkPreviewCard(card, url);
    });
  }, [buildLinkPreviewCard, createLinkAnchor, hydrateLinkPreviewCard]);

  useEffect(() => {
    const root = editorRef.current;
    if (!root) return;

    let rafId: number | null = null;
    const schedule = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => processLinksAndEmbeds());
    };

    const observer = new MutationObserver(() => schedule());
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    // initial pass (e.g. restored from localStorage)
    schedule();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [processLinksAndEmbeds]);


  const createLinkRow = useCallback((url: string, label: string) => {
    const row = document.createElement('div');
    row.className = 'mt-2 flex items-center gap-2';

    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', label);
    link.tabIndex = 0;
    link.addEventListener('keydown', (event) => {
      if (event.key !== ' ') return;
      event.preventDefault();
      window.open(url, '_blank', 'noopener,noreferrer');
    });

    const iconSpan = document.createElement('span');
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.style.color = '#6e6e6e';
    iconSpan.style.flexShrink = '0';
    iconSpan.style.fontSize = '14px';
    iconSpan.style.lineHeight = '1';
    iconSpan.textContent = '\u2197';

    link.appendChild(iconSpan);
    link.appendChild(createAiTextSpan(label));
    link.className = 'inline-flex items-center gap-2';
    row.appendChild(link);
    return row;
  }, []);

  const createAiTextBlock = useCallback(
    (text: string, className?: string) => {
      const el = document.createElement('div');
      if (className) el.className = className;
      el.appendChild(createAiTextSpan(text));
      return el;
    },
    []
  );

  const hydrateSearchResultImages = useCallback((root: HTMLElement | null) => {
    if (!root) return;
    const imgs = root.querySelectorAll<HTMLImageElement>('img[data-proxy-url]');
    imgs.forEach((img) => {
      const proxyUrl = img.dataset.proxyUrl;
      if (!proxyUrl) return;
      fetch(proxyUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const ct = (res.headers.get('content-type') || '').toLowerCase();
          if (!ct.startsWith('image/')) throw new Error('Not an image');
          return res.blob();
        })
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          img.src = url;
          img.onload = () => URL.revokeObjectURL(url);
        })
        .catch(() => {
          const figure = img.closest('figure');
          const fallbackUrl = img.dataset.fallbackUrl || figure?.dataset.fallbackUrl || '';
          const fallback = document.createElement('div');
          if (fallbackUrl) {
            const imgLabel = img.alt ? `Open image: ${img.alt}` : 'Open image';
            fallback.appendChild(createLinkRow(fallbackUrl, imgLabel));
          } else {
            fallback.appendChild(createAiTextSpan('Image unavailable'));
          }
          img.parentNode?.insertBefore(fallback, img);
          img.remove();
        });
    });
  }, []);

  const createInlineResultCard = useCallback(
    (item: ResultItem) => {
      const isMedia = item.type === 'video' || item.type === 'image';
      const container = document.createElement('div');

      container.className = resultCardClasses.item;
      container.dataset.resultType = item.type;
      if (item.url) container.dataset.url = item.url;
      if (isMedia) container.contentEditable = 'false';

      if (item.type === 'image' || item.type === 'video') {
        const imageUrl = item.thumbnail || item.url || '';
        if (imageUrl) {
          const img = document.createElement('img');
          const proxyUrl = `/api/ai/image?url=${encodeURIComponent(imageUrl)}`;
          // Set proxy URL both as dataset (for hydrate/fallback) and initial src so the browser attempts to load it immediately.
          img.dataset.proxyUrl = proxyUrl;
          img.src = proxyUrl;
          if (item.url) img.dataset.fallbackUrl = item.url;
          img.alt = item.title || (item.type === 'video' ? 'Video thumbnail' : 'Image');
          img.className = resultCardClasses.image;
          img.style.minHeight = '120px';
          img.style.backgroundColor = 'var(--color-gray-100, #f3f4f6)';
          img.loading = 'lazy';

          // On error, replace image with a fallback link or note.
          img.onerror = () => {
            const figure = img.closest('figure') || img.parentElement;
            const fallbackUrl = img.dataset.fallbackUrl || (figure?.dataset.fallbackUrl || '');
            const fallback = document.createElement('div');
            if (fallbackUrl) {
              const imgLabel = img.alt ? `Open image: ${img.alt}` : 'Open image';
              fallback.appendChild(createLinkRow(fallbackUrl, imgLabel));
            } else {
              fallback.appendChild(createAiTextSpan('Image unavailable'));
            }
            if (img.parentNode) {
              img.parentNode.insertBefore(fallback, img);
            }
            img.remove();
          };

          container.appendChild(img);
        }
        if (item.url) {
          const imgLabel = item.title ? `Open image: ${item.title}` : 'Open image';
          container.appendChild(createLinkRow(item.url, imgLabel));
        }
        return container;
      }

      if (item.type === 'article') {
        container.appendChild(createAiTextBlock(item.snippet || item.title));
        if (item.url) {
          const articleLabel = item.title ? `Open article: ${item.title}` : 'Open article';
          container.appendChild(createLinkRow(item.url, articleLabel));
        }
      }

      return container;
    },
    [createAiTextBlock, createLinkRow]
  );

  const buildSearchResultsBlock = useCallback(
    async (items: ResultItem[]): Promise<HTMLElement> => {
      const resultsContainer = document.createElement('div');
      resultsContainer.className = resultCardClasses.block;
      resultsContainer.dataset.embed = 'search-results';
      resultsContainer.contentEditable = 'false';

      const searchableItems = items.filter((item) => item.type !== 'snippet');
      const mediaItems = searchableItems.filter((item) => item.type === 'image' || item.type === 'video');
      const infoItems = searchableItems.filter((item) => item.type === 'article');

      const limitedMedia = mediaItems.slice(0, 1); // keep visuals minimal
      const limitedInfo = infoItems.slice(0, 6); // we'll summarize these

      if (limitedMedia.length === 0 && limitedInfo.length === 0) {
        resultsContainer.appendChild(createAiTextBlock('No results found. Try a different search query.'));
        return resultsContainer;
      }

      // Show a single representative media item (if any)
      if (limitedMedia.length > 0) {
        limitedMedia.forEach((item) => {
          resultsContainer.appendChild(createInlineResultCard(item));
        });
      }

      // Build a concise combined summary from article snippets/titles
      const textForSummary = limitedInfo
        .map((it) => (it.snippet ? `${it.title}: ${it.snippet}` : it.title))
        .join('\n\n');

      let summaryText = '';
      try {
        if (textForSummary.trim()) {
          const gen = await generateWithGemini('summarize', textForSummary, selectedModel);
          if (gen.ok && gen.text) {
            summaryText = gen.text.replace(/\s+/g, ' ').trim();
          }
        }
      } catch (e) {
        // fall back to a simple handcrafted summary
        summaryText = limitedInfo.length
          ? limitedInfo.map((i) => i.title).slice(0, 3).join('; ')
          : '';
      }

      if (!summaryText && limitedInfo.length > 0) {
        // fallback short human-readable summary
        summaryText = limitedInfo
          .map((it) => it.title)
          .slice(0, 3)
          .join('; ');
      }

      if (summaryText) {
        const p = document.createElement('div');
        p.appendChild(createAiTextSpan(summaryText));
        resultsContainer.appendChild(p);
      }

      // Add at most one short quoted excerpt (conservative)
      const excerptItem = limitedInfo.find((i) => {
        if (!i.snippet || !i.snippet.trim()) return false;
        const len = i.snippet.trim().length;
        return len >= 20 && len <= 400;
      });

      if (excerptItem) {
        const block = document.createElement('blockquote');
        block.className = resultCardClasses.quote;
        block.appendChild(document.createTextNode(excerptItem.snippet || ''));
        resultsContainer.appendChild(block);

        if (excerptItem.url) {
          const excerptLink = createLinkRow(
            excerptItem.url,
            excerptItem.title ? `Open article: ${excerptItem.title}` : 'Open source'
          );
          resultsContainer.appendChild(excerptLink);
        }
      }

      // Sources list (compact) — use the same "Open ..." style as other links
      if (limitedInfo.length > 0) {
        const sourcesWrapper = document.createElement('div');
        sourcesWrapper.className = 'mt-2 text-xs text-gray-600';
        const label = document.createElement('div');
        label.className = 'text-[11px] text-gray-500 mb-1';
        label.textContent = 'Sources';
        sourcesWrapper.appendChild(label);

        const listDiv = document.createElement('div');
        listDiv.style.display = 'flex';
        listDiv.style.flexDirection = 'column';
        listDiv.style.gap = '4px';

        limitedInfo.forEach((it) => {
          if (!it.url) return;
          const linkRow = createLinkRow(
            it.url,
            it.title ? `Open article: ${it.title}` : it.url
          );
          listDiv.appendChild(linkRow);
        });

        sourcesWrapper.appendChild(listDiv);
        resultsContainer.appendChild(sourcesWrapper);
      }

      return resultsContainer;
    },
    [createAiTextBlock, createInlineResultCard, createLinkRow, selectedModel]
  );

  const insertSearchResultsInline = useCallback(
    async ({
      items,
      selection,
      insertAfterNode,
    }: {
      items: ResultItem[];
      selection: Selection | null;
      insertAfterNode?: Node | null;
    }) => {
      if (!editorRef.current) {
        console.error('Cannot insert: editorRef is null');
        return null;
      }

      if (items.length === 0) return null;

      let insertAfterElement: Node | null = insertAfterNode ?? null;

      if (!insertAfterElement && selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0).cloneRange();
        let container: Node = range.startContainer;
        if (container.nodeType === Node.TEXT_NODE) {
          container = container.parentElement || container;
        }
        let current: Node | null = container as Node;
        while (current && current !== editorRef.current) {
          if (current.nodeType === Node.ELEMENT_NODE) {
            const el = current as HTMLElement;
            if (el.tagName === 'P' || el.tagName === 'DIV' || el.tagName.match(/^H[1-6]$/) || el.tagName === 'LI') {
              insertAfterElement = el;
              break;
            }
          }
          current = current.parentNode;
        }
        if (!insertAfterElement) insertAfterElement = container;
      }

      if (!insertAfterElement) return null;

      try {
        const sel = window.getSelection();
        if (!sel || !editorRef.current) return null;

        const insertRange = document.createRange();
        if (insertAfterElement.parentNode) {
          insertRange.setStartAfter(insertAfterElement);
          insertRange.collapse(true);
        } else {
          insertRange.selectNodeContents(editorRef.current);
          insertRange.collapse(false);
        }

        const resultsContainer = await buildSearchResultsBlock(items);
        insertRange.insertNode(resultsContainer);

        const br = document.createElement('br');
        insertRange.setStartAfter(resultsContainer);
        insertRange.collapse(true);
        insertRange.insertNode(br);

        insertRange.setStartAfter(br);
        insertRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(insertRange);

        editorRef.current?.focus();
        return resultsContainer;
      } catch (error) {
        console.error('Error inserting results:', error);
        setAiError('Could not insert search results. ' + (error instanceof Error ? error.message : String(error)));
        return null;
      }
    },
    [buildSearchResultsBlock, setAiError]
  );

  type SkeletonNotesBlock =
    | { kind: 'ai'; text: string }
    | { kind: 'input'; prompt: string; lines: number };

  const parseSkeletonNotes = useCallback((rawText: string): { blocks: SkeletonNotesBlock[] } | null => {
    const trimmed = rawText.trim();
    if (!trimmed) return null;

    // If the model appended a search tag after JSON, peel it off first.
    const firstNewlineSearchTagIndex = trimmed.search(/\n\s*\[SEARCH_(?:VIDEOS|ARTICLES|IMAGES|ALL):/);
    const jsonCandidate = firstNewlineSearchTagIndex >= 0 ? trimmed.slice(0, firstNewlineSearchTagIndex).trim() : trimmed;

    if (!jsonCandidate.startsWith('{')) return null;

    try {
      const parsed = JSON.parse(jsonCandidate) as unknown;
      if (!parsed || typeof parsed !== 'object') return null;

      const maybeBlocks = (parsed as { blocks?: unknown }).blocks;
      if (!Array.isArray(maybeBlocks)) return null;

      const normalized: SkeletonNotesBlock[] = [];
      for (const b of maybeBlocks) {
        if (!b || typeof b !== 'object') continue;
        const kind = (b as { kind?: unknown }).kind;
        if (kind !== 'ai' && kind !== 'input') continue;

        if (kind === 'ai') {
          const text = typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text.trim() : '';
          if (!text) continue;
          normalized.push({ kind: 'ai', text });
          continue;
        }

        const prompt = typeof (b as { prompt?: unknown }).prompt === 'string' ? (b as { prompt: string }).prompt.trim() : '';
        const linesRaw = (b as { lines?: unknown }).lines;
        const lines = typeof linesRaw === 'number' ? Math.floor(linesRaw) : Number(linesRaw);
        if (!prompt) continue;
        const safeLines = Number.isFinite(lines) ? Math.max(1, Math.min(lines, 6)) : 1;
        normalized.push({ kind: 'input', prompt, lines: safeLines });
      }

      if (normalized.length === 0) return null;
      return { blocks: normalized };
    } catch {
      return null;
    }
  }, []);

  const insertSkeletonNotesInline = useCallback(
    async (insertRange: Range, blocks: SkeletonNotesBlock[], inlineItems?: ResultItem[]): Promise<Node | null> => {
      const fragment = document.createDocumentFragment();
      let lastNode: Node | null = null;

      const createHumanBlankLine = () => {
        const p = document.createElement('p');
        // Non-breaking space ensures the line is visible/clickable.
        const userSpan = createHumanTextSpan('\u00A0');
        p.appendChild(userSpan);
        return p;
      };

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const nextBlock = i < blocks.length - 1 ? blocks[i + 1] : null;

        if (block.kind === 'ai') {
          const p = document.createElement('p');
          p.appendChild(createAiTextWithLinksFragment(block.text));
          fragment.appendChild(p);
          lastNode = p;

          // Detect if this is a label (short text, typically single word/phrase)
          // Labels don't need a gap below them.
          const isLabel = block.text.length < 60 && 
            !block.text.trim().match(/[.!?]$/);

          // Only add a gap if:
          // 1. It's not a label, AND
          // 2. The next block is either null (last block) or an input block (not another AI block)
          // This ensures consecutive AI blocks (like multiple summary sentences) stay together
          const shouldAddGap = !isLabel && (nextBlock === null || nextBlock.kind === 'input');

          if (shouldAddGap) {
            // Regular AI outputs (e.g. summary content) should have
            // **one blank line** below them, but only after the last AI block in a sequence.
            const gap = createHumanBlankLine();
            fragment.appendChild(gap);
            lastNode = gap;
          }
          continue;
        }

        // input block: gray prompt + N blank human lines
        const promptP = document.createElement('p');
        promptP.appendChild(createAiTextSpan(block.prompt));
        fragment.appendChild(promptP);
        lastNode = promptP;

        for (let i = 0; i < block.lines; i += 1) {
          const line = createHumanBlankLine();
          fragment.appendChild(line);
          lastNode = line;
        }

        // Questions for the user should have **exactly two gaps** below them:
        // - the gap(s) for the user's response (the blank lines we just added)
        // - one regular spacing gap before the next content
        // Only add the extra gap if we only have 1 answer line, otherwise
        // the multiple answer lines already provide enough spacing.
        if (block.lines === 1) {
          const extraGap = createHumanBlankLine();
          fragment.appendChild(extraGap);
          lastNode = extraGap;
        }
      }
      // If inlineItems (search results) were provided, append a rich results block
      // into the skeleton fragment so media (images/videos) render inline with AI notes.
      let resultsContainer: HTMLElement | null = null;
      try {
        if (inlineItems && inlineItems.length > 0) {
          // Build a compact results block (may include media thumbnails, links, excerpt)
          resultsContainer = await buildSearchResultsBlock(inlineItems);
          if (resultsContainer) {
            fragment.appendChild(resultsContainer);
            lastNode = resultsContainer;
          }
        }
      } catch (err) {
        console.warn('Failed to build inline search results for skeleton:', err);
      }

      insertRange.insertNode(fragment);

      // If we added images that require hydration/proxy fetches, hydrate them now.
      if (resultsContainer) {
        // Results container is now in the DOM; hydrate images.
        try {
          hydrateSearchResultImages(resultsContainer);
        } catch {
          // ignore hydration failures
        }
      }

      return lastNode;
    },
    [createAiTextWithLinksFragment, buildSearchResultsBlock, hydrateSearchResultImages]
  );

  const handleAiReview = useCallback(async () => {
    const selection = window.getSelection();
    if (!selection || !editorRef.current) return;

    const getEditorPlainText = (): string => {
      const editor = editorRef.current;
      if (!editor) return '';
      const raw = (editor.innerText || editor.textContent || '').trim();
      if (!raw) return '';
      return raw.replace(/Start writing\.\.\./g, '').trim();
    };

    // Always get the full editor text for context
    const fullEditorText = getEditorPlainText();
    
    if (!fullEditorText || fullEditorText === 'Start writing...') {
      setAiError('No text found to review. Please write something first.');
      return;
    }

    // Get the current cursor position
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    if (!range) return;

    // Find the paragraph or block element containing the cursor
    let container: Node = range.startContainer;
    if (container.nodeType === Node.TEXT_NODE) {
      container = container.parentElement || container;
    }

    // Walk up to find a block element (p, div, h1-h6, li, etc.)
    let blockElement: HTMLElement | null = null;
    let current: Node | null = container as Node;
    
    while (current && current !== editorRef.current) {
      if (current.nodeType === Node.ELEMENT_NODE) {
        const el = current as HTMLElement;
        if (el.tagName === 'P' || el.tagName === 'DIV' || 
            el.tagName.match(/^H[1-6]$/) || el.tagName === 'LI' ||
            el.tagName === 'BLOCKQUOTE') {
          blockElement = el;
          break;
        }
      }
      current = current.parentNode;
    }

    // Get the text at the cursor position (the "new" text to focus on)
    let newTextAtCursor = '';
    let insertAfterElement: Node | null = null;

    if (blockElement) {
      // Get all text from the block element
      const textRange = document.createRange();
      textRange.selectNodeContents(blockElement);
      newTextAtCursor = textRange.toString().trim();
      insertAfterElement = blockElement;
    } else {
      // Fallback: if no block element, try to find the containing element
      let startNode: Node = range.startContainer;
      let bestContainingElement: HTMLElement | null = null;
      
      // Walk up and keep the highest-level element with meaningful text.
      let current: Node | null = startNode;
      while (current && current !== editorRef.current) {
        if (current.nodeType === Node.ELEMENT_NODE) {
          const el = current as HTMLElement;
          const textContent = el.textContent?.trim() || '';
          if (textContent && textContent !== 'Start writing...') {
            bestContainingElement = el;
          }
        }
        current = current.parentNode;
      }
      
      if (bestContainingElement) {
        // Get all text from this containing element
        const textRange = document.createRange();
        textRange.selectNodeContents(bestContainingElement);
        newTextAtCursor = textRange.toString().trim();
        insertAfterElement = bestContainingElement;
      } else {
        // Use the full editor text as fallback
        newTextAtCursor = fullEditorText;
        
        // Find the last element with text to insert after
        const walker = document.createTreeWalker(
          editorRef.current,
          NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
          {
            acceptNode: (node) => {
              // Skip placeholder
              if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === 'Start writing...') {
                return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_ACCEPT;
            }
          }
        );
        
        let lastElement: Node | null = null;
        let node: Node | null;
        while (node = walker.nextNode()) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            if (el.textContent?.trim() && el.textContent.trim() !== 'Start writing...') {
              lastElement = el;
            }
          } else if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent?.trim() || '';
            if (text && text !== 'Start writing...') {
              lastElement = node.parentElement || node;
            }
          }
        }
        
        // Use the last element or editor as insert point
        if (lastElement) {
          insertAfterElement = lastElement as HTMLElement;
        } else if (editorRef.current.lastChild) {
          insertAfterElement = editorRef.current.lastChild as HTMLElement;
        } else {
          insertAfterElement = editorRef.current;
        }
      }
    }

    // If we somehow captured only a fragment (common with styled spans),
    // use the full editor text as the new text too.
    if (newTextAtCursor.length > 0 && newTextAtCursor.length < 20 && fullEditorText.length > newTextAtCursor.length) {
      newTextAtCursor = fullEditorText;
      insertAfterElement = editorRef.current;
    }

    // Construct the prompt with full context and highlighted new text
    // Format: include full context, but mark the new text so AI knows to focus on it
    let textToReview: string;
    if (newTextAtCursor && newTextAtCursor !== fullEditorText && fullEditorText.includes(newTextAtCursor)) {
      // The new text is part of the full context - format it to highlight it
      textToReview = `Full document context:\n${fullEditorText}\n\n---\n\nFocus on this newly written text (the user just wrote this):\n${newTextAtCursor}`;
    } else {
      // If they're the same or new text not found in full context, just use full context
      textToReview = fullEditorText;
    }

    // New flow: plan + run searches first, build a concise search-summary (no raw URLs),
    // then call the review generation so the AI info paragraph can incorporate findings.
    setAiError(null);
    setAiLoading(true);

    let inlineItems: ResultItem[] = [];
    let skeleton: { blocks: any[] } | null = null;
    let aiResponseText: string = '';

    const ensureCoverageQueries = (
      plan: GeminiSearchPlan,
      baseQuery: string,
    ): GeminiSearchPlan => {
      const trimmed = baseQuery.trim();
      const safeQuery = trimmed.length > 140 ? trimmed.slice(0, 140) : trimmed;

      const findQueryByType = (type: GeminiSearchType) =>
        plan.queries.find((q) => q.type === type);

      const imageQuery = findQueryByType('image') ?? {
        type: 'image' as const,
        query: `${safeQuery} high quality photo`,
        reason: 'Provide a concrete visual reference.',
      };
      const videoQuery = findQueryByType('video') ?? {
        type: 'video' as const,
        query: `${safeQuery} explainer video`,
        reason: 'Provide a visual walkthrough.',
      };
      const webQuery = findQueryByType('web') ?? {
        type: 'web' as const,
        query: `${safeQuery} longform article analysis`,
        reason: 'Provide a deeper, text-based source.',
      };

      return { shouldSearch: true, queries: [imageQuery, videoQuery, webQuery].slice(0, 3) };
    };

    setIsSearching(true);
    try {
      // 1) Plan searches based on the user's text (before AI review)
      let plan = await planSearchWithGemini(textToReview, selectedModel);

      if (!plan.shouldSearch || plan.queries.length === 0) {
        plan = ensureCoverageQueries({ shouldSearch: true, queries: [] }, textToReview);
      } else {
        plan = ensureCoverageQueries(plan, textToReview);
      }

      // 2) Execute agent searches (if any) and normalize to inlineItems for insertion
      if (plan.shouldSearch && plan.queries.length > 0) {
        const agentQueries: AgentSearchRequest[] = plan.queries.map((q) => ({
          type: q.type === 'web' ? 'article' : (q.type as AgentSearchResult['type']),
          query: q.query,
        }));
        const agentResults = await searchWithAgent(agentQueries, selectedModel);
        const items = orderedSearchResultsToItems(agentResults);
        const mediaFirstOrder: ResultItemType[] = ['image', 'video', 'article', 'snippet'];
        // Sort and dedupe by url (prefer first occurrence)
        const sorted = [...items].sort(
          (a, b) => mediaFirstOrder.indexOf(a.type) - mediaFirstOrder.indexOf(b.type)
        );
        const seen = new Set<string>();
        inlineItems = [];
        for (const it of sorted) {
          const key = (it.url || it.title || '').trim();
          if (!key) continue;
          if (seen.has(key)) continue;
          seen.add(key);
          inlineItems.push(it);
        }
      }

      // 3) Build a concise search-summary for the reviewer model (no raw URLs, only titles/snippets/types)
      const summaryParts: string[] = [];
      const mediaPreview = inlineItems.find((it) => it.type === 'image' || it.type === 'video');
      if (mediaPreview) {
        summaryParts.push(`${mediaPreview.type.toUpperCase()}: ${mediaPreview.title || mediaPreview.snippet || ''}`.trim());
      }
      const infoItems = inlineItems.filter((it) => it.type === 'article').slice(0, 4);
      for (const it of infoItems) {
        const line = it.snippet ? `${it.title}: ${it.snippet}` : it.title;
        summaryParts.push(line);
      }

      const searchSummaryForAI = summaryParts.join('\n').trim();

      // 4) Call the reviewer generation with search findings appended so the info paragraph can use them.
      // Instruct model: no raw URLs in output. We include the searchSummary but ensure it contains no urls.
      const reviewInput = searchSummaryForAI
        ? `${textToReview}\n\nSearch findings (titles/snippets only, do NOT include raw URLs):\n${searchSummaryForAI}`
        : textToReview;

      const result = await generateWithGemini('review', reviewInput, selectedModel);

      if (!result.ok) {
        setAiError(result.error);
        setAiLoading(false);
        return;
      }

      skeleton = parseSkeletonNotes(result.text);
      aiResponseText = result.text.replace(/\[SEARCH_\w+:\s*.+?\]/g, '').trim();

      // Normalize skeleton blocks: ensure AI information section is a single paragraph.
      if (skeleton && Array.isArray(skeleton.blocks)) {
        const normalizedBlocks: typeof skeleton.blocks = [];
        for (const b of skeleton.blocks) {
          if (b.kind === 'ai') {
            // Collapse whitespace/newlines into single spaces to avoid multi-paragraph AI blocks.
            const cleanText = (b.text || '').replace(/\s+/g, ' ').trim();
            const last = normalizedBlocks[normalizedBlocks.length - 1];
            if (last && last.kind === 'ai') {
              // Merge into previous ai block (separate sentences with a space).
              last.text = `${last.text.replace(/\s+/g, ' ').trim()} ${cleanText}`.trim();
            } else {
              normalizedBlocks.push({ kind: 'ai', text: cleanText });
            }
          } else {
            // input blocks: keep as-is but sanitize prompt whitespace
            const prompt = (b.prompt || '').replace(/\s+/g, ' ').trim();
            const linesRaw = (b.lines || 1);
            normalizedBlocks.push({ kind: 'input', prompt, lines: Number.isFinite(linesRaw) ? Math.max(1, Math.min(6, Math.floor(linesRaw))) : 1 });
          }
        }

        // Ensure we don't have more than one AI info block at the start.
        // If there are multiple ai blocks, merge all consecutive leading ai blocks.
        if (normalizedBlocks.length > 1) {
          const firstAiIndex = normalizedBlocks.findIndex((x) => x.kind === 'ai');
          if (firstAiIndex >= 0) {
            // Merge any ai blocks that appear before the first input block.
            let mergeText = '';
            let i = firstAiIndex;
            while (i < normalizedBlocks.length && normalizedBlocks[i].kind === 'ai') {
              mergeText = `${mergeText} ${normalizedBlocks[i].text}`.trim();
              i += 1;
            }
            // Replace the leading ai blocks with a single ai block
            const rest = normalizedBlocks.slice(i);
            const merged = [{ kind: 'ai', text: mergeText }, ...rest];
            skeleton.blocks = merged;
          } else {
            skeleton.blocks = normalizedBlocks;
          }
        } else {
          skeleton.blocks = normalizedBlocks;
        }
      }

      // If the model suggested additional searches via tag, try to honor them (best-effort).
      const extraSearchTagMatch = result.text.match(/\[SEARCH_(?:VIDEOS|ARTICLES|IMAGES|ALL):\s*(.+?)\]/);
      if (extraSearchTagMatch && extraSearchTagMatch[1]) {
        try {
          const tagQuery = extraSearchTagMatch[1].trim();
          const ensured = ensureCoverageQueries({ shouldSearch: true, queries: [] }, tagQuery);
          const agentQueries: AgentSearchRequest[] = ensured.queries.map((q) => ({
            type: q.type === 'web' ? 'article' : (q.type as AgentSearchResult['type']),
            query: q.query,
          }));
          const agentResults = await searchWithAgent(agentQueries, selectedModel);
          const items = orderedSearchResultsToItems(agentResults);
          inlineItems = [...inlineItems, ...items];
          const mediaFirstOrder: ResultItemType[] = ['image', 'video', 'article', 'snippet'];
          inlineItems = inlineItems.sort(
            (a, b) => mediaFirstOrder.indexOf(a.type) - mediaFirstOrder.indexOf(b.type)
          );
        } catch (e) {
          // ignore extra search failures
        }
      }
    } catch (searchError) {
      console.error('Auto-search failed:', searchError);
      setAiError(
        'Search request failed. ' + (searchError instanceof Error ? searchError.message : String(searchError))
      );
    } finally {
      setIsSearching(false);
    }

    // Insert: [user paragraph] → [search results if any] → [gap] → [AI review]
    try {
      const sel = window.getSelection();
      if (!sel || !editorRef.current || !insertAfterElement) return;

      let insertPoint: Node = insertAfterElement;

      // inlineItems (rich search results) will be passed into the skeleton inserter
      // so embeds (images/videos) render inline with AI notes. No separate results block.

      const insertRange = document.createRange();
      if (insertPoint.parentNode) {
        insertRange.setStartAfter(insertPoint);
        insertRange.collapse(true);
      } else {
        insertRange.selectNodeContents(editorRef.current);
        insertRange.collapse(false);
      }

      const preGap = document.createElement('p');
      const preGapSpan = createHumanTextSpan('\u00A0');
      preGap.appendChild(preGapSpan);
      insertRange.insertNode(preGap);
      insertRange.setStartAfter(preGap);
      insertRange.collapse(true);

      let lastInsertedNode: Node | null = null;
      if (skeleton) {
        lastInsertedNode = await insertSkeletonNotesInline(insertRange, skeleton.blocks, inlineItems);
      } else {
        const syntheticBlocks: SkeletonNotesBlock[] = [{ kind: 'ai', text: aiResponseText }];
        lastInsertedNode = await insertSkeletonNotesInline(insertRange, syntheticBlocks, inlineItems);
      }

      if (lastInsertedNode) {
        insertRange.setStartAfter(lastInsertedNode);
        insertRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(insertRange);
      }
    } catch (error) {
      setAiError('Could not insert review. ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setAiLoading(false);
    }

    editorRef.current?.focus();
  }, [
    insertSkeletonNotesInline,
    parseSkeletonNotes,
    selectedModel,
    setAiError,
    setAiLoading,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const ctrlKey = isMac ? e.metaKey : e.ctrlKey;

      // Check if editor is focused
      const isEditorFocused = editorRef.current?.contains(document.activeElement);
      
      // Handle printable characters when editor is focused (but not with modifiers)
      if (isEditorFocused && !ctrlKey && !e.altKey && e.key.length === 1 && !e.metaKey) {
        // Only intercept if it's a printable character (including spaces)
        const isPrintable = e.key.length === 1 && e.key !== 'Enter' && e.key !== 'Tab' && e.key !== 'Escape';
        if (isPrintable) {
          e.preventDefault();
          e.stopPropagation();
          
          // Get current selection and insert styled text
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0 && editorRef.current) {
            insertStyledText(e.key);
          }
          return;
        }
      }

      // Escape - Clear selection
      if (e.key === 'Escape') {
        e.preventDefault();
        window.getSelection()?.removeAllRanges();
        return;
      }

      // Bold - Ctrl/Cmd + B
      if (ctrlKey && e.key === 'b') {
        e.preventDefault();
        document.execCommand('bold');
      }
      
      // Italic - Ctrl/Cmd + I
      if (ctrlKey && e.key === 'i') {
        e.preventDefault();
        document.execCommand('italic');
      }
      
      // Underline - Ctrl/Cmd + U
      if (ctrlKey && e.key === 'u') {
        e.preventDefault();
        document.execCommand('underline');
      }
      
      // Save - Ctrl/Cmd + S
      if (ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      
      // Undo - Ctrl/Cmd + Z
      if (ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        document.execCommand('undo');
      }
      
      // Redo - Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z
      if ((ctrlKey && e.key === 'y') || (ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        document.execCommand('redo');
      }

      // Show shortcuts - Ctrl/Cmd + /
      if (ctrlKey && e.key === '/') {
        e.preventDefault();
        setShowShortcuts(prev => !prev);
      }

      // AI Review - Ctrl/Cmd + Enter (only when editor is focused)
      if (isEditorFocused && ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleAiReview();
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown, true); // Use capture phase
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleAiReview]);

  const handleFormat = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };

  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(event.target.value);
  };

  const handleAiAction = async (action: GeminiAction) => {
    const selection = window.getSelection();
    if (!selection || !editorRef.current) return;

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    const selectedText = (selection.toString() ?? '').trim();

    if (!selectedText) {
      setAiError('Select some text first.');
      return;
    }

    setAiError(null);
    setAiLoading(true);
    savedSelection.current = range;

    const result = await generateWithGemini(action, selectedText, selectedModel);
    setAiLoading(false);

    if (!result.ok) {
      setAiError(result.error);
      return;
    }

    const r = savedSelection.current;
    const editor = editorRef.current;
    if (r && editor.contains(r.startContainer)) {
      try {
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(r);
          r.deleteContents();
          
          // Insert AI-generated text with AI styling (gray Inter 18pt)
          const aiSpan = createAiTextSpan(result.text);
          r.insertNode(aiSpan);
          
          r.collapse(false);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      } catch {
        setAiError('Could not replace selection. Result: ' + result.text.slice(0, 80));
      }
    } else {
      setAiError('Selection changed. Result: ' + result.text.slice(0, 120));
    }
    editorRef.current?.focus();
  };

  const handleSave = () => {
    if (editorRef.current) {
      const content = editorRef.current.innerHTML;
      localStorage.setItem('documentContent', content);
      
      // Show save notification
      const notification = document.createElement('div');
      notification.textContent = 'Document saved!';
      notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
      document.body.appendChild(notification);
      setTimeout(() => notification.remove(), 2000);
    }
  };

  // Load saved content on mount
  useEffect(() => {
    const savedContent = localStorage.getItem('documentContent');
    if (savedContent && editorRef.current) {
      editorRef.current.innerHTML = savedContent;
      requestAnimationFrame(() => hydrateSearchResultImages(editorRef.current));
    }
    // If no saved content, the placeholder "Start writing..." is already in the JSX
  }, [hydrateSearchResultImages]);

  const isClickInSelection = (x: number, y: number): boolean => {
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
    
    // Handle shift+click/drag for multi-selection
    if (e.shiftKey && selection && !selection.isCollapsed) {
      e.preventDefault();
      
      // Save the current selection as an additional selection
      const currentRange = selection.getRangeAt(0).cloneRange();
      setAdditionalSelections(prev => [...prev, currentRange]);
      
      // Start a new selection
      setIsShiftSelecting(true);
      shiftSelectStart.current = { x: e.clientX, y: e.clientY };
      return;
    }
    
    // Check if clicking inside existing selection (for drag and drop)
    if (selection && !selection.isCollapsed && isClickInSelection(e.clientX, e.clientY) && !e.shiftKey) {
      e.preventDefault();
      
      // Combine all selections (main + additional) for dragging
      const mainRange = selection.getRangeAt(0);
      const allRanges = [mainRange, ...additionalSelections];
      
      // Create a combined fragment
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
      // Clear additional selections if not shift-clicking
      setAdditionalSelections([]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && dragStartPos.current) {
      // Check if Alt/Option key is pressed for duplication
      setIsDuplicating(e.altKey);
      
      // Check if moved enough to start drag
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) {
        document.body.style.cursor = 'grabbing';
        
        // Update dragged element position
        setDragElementPos({ x: e.clientX, y: e.clientY });
        
        // Determine drop target
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
            
            // Get all actual line positions from the editor content
            const lines: { top: number; bottom: number; left: number }[] = [];
            
            // Walk through block-level elements and get all line boxes within them
            const blockElements = editorRef.current.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div, li');
            
            blockElements.forEach((element) => {
              const range = document.createRange();
              
              // Select the entire content of the block element
              range.selectNodeContents(element);
              
              // Get all client rects - each rect represents a visual line
              const rects = range.getClientRects();
              
              for (let i = 0; i < rects.length; i++) {
                const rect = rects[i];
                if (rect.height > 0 && rect.width > 0) {
                  lines.push({
                    top: rect.top,
                    bottom: rect.bottom,
                    left: rect.left
                  });
                }
              }
            });
            
            // Also handle any text nodes that aren't in block elements
            const walker = document.createTreeWalker(
              editorRef.current,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode: (node) => {
                  // Only accept text nodes that are direct children or not in a block element
                  const parent = node.parentElement;
                  if (!parent) return NodeFilter.FILTER_REJECT;
                  
                  const isInBlock = parent.closest('p, h1, h2, h3, h4, h5, h6, div, li');
                  return !isInBlock ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                }
              }
            );
            
            let node;
            while (node = walker.nextNode()) {
              if (node.textContent?.trim()) {
                const range = document.createRange();
                range.selectNodeContents(node);
                const rects = range.getClientRects();
                
                for (let i = 0; i < rects.length; i++) {
                  const rect = rects[i];
                  if (rect.height > 0 && rect.width > 0) {
                    lines.push({
                      top: rect.top,
                      bottom: rect.bottom,
                      left: rect.left
                    });
                  }
                }
              }
            }
            
            // Sort lines by top position
            lines.sort((a, b) => a.top - b.top);
            
            // Find the appropriate line to snap to
            let targetLine: { top: number; bottom: number; left: number } | null = null;
            
            // First, check if we're within any line's vertical bounds
            for (const line of lines) {
              if (e.clientY >= line.top && e.clientY <= line.bottom) {
                targetLine = line;
                break;
              }
            }
            
            // If not within any line, find which line we're between
            if (!targetLine) {
              for (let i = 0; i < lines.length - 1; i++) {
                const currentLine = lines[i];
                const nextLine = lines[i + 1];
                
                // Check if we're in the gap between these two lines
                if (e.clientY > currentLine.bottom && e.clientY < nextLine.top) {
                  // Use the midpoint of the gap to decide which line to snap to
                  const gapMidpoint = (currentLine.bottom + nextLine.top) / 2;
                  targetLine = e.clientY < gapMidpoint ? currentLine : nextLine;
                  break;
                }
              }
            }
            
            // If we're below all content or no lines found, calculate virtual line positions
            const lastLine = lines.length > 0 ? lines[lines.length - 1] : null;
            const editorTop = editorRect.top;
            
            if (!targetLine || (lastLine && e.clientY > lastLine.bottom + 10)) {
              // We're below content - create virtual lines
              const startY = lastLine ? lastLine.bottom : editorTop;
              const avgLineHeight = lastLine ? (lastLine.bottom - lastLine.top) : 28;
              
              // Calculate which virtual line we're on
              const relativeY = e.clientY - startY;
              const virtualLineIndex = Math.round(relativeY / avgLineHeight);
              const snappedY = startY + (virtualLineIndex * avgLineHeight);
              
              setDropCursorPos({ 
                x: e.clientX,
                y: snappedY 
              });
            } else if (targetLine) {
              // Snap to the target line
              setDropCursorPos({ 
                x: e.clientX,
                y: targetLine.top
              });
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
        // Add to margin
        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const id = `margin-text-${Date.now()}-${Math.random()}`;
          const content = draggedContent;
          
          // Create a temporary container to get HTML
          const tempDiv = document.createElement('div');
          tempDiv.appendChild(draggedFragment.current.cloneNode(true));
          const htmlContent = tempDiv.innerHTML;
          
          // Determine the new margin side
          const newSide = dragTarget === 'left-margin' ? 'left' : 'right';
          
          // Calculate position relative to the container
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
          
          // Don't delete from editor - just copy to margin
          // savedRange.current.deleteContents();
          
          // Set the margin side and add the text
          setMarginSide(newSide);
          setMarginTexts(prev => [
            ...prev,
            {
              id,
              content,
              htmlContent,
              x: marginX,
              y: marginY
            }
          ]);
          
          // Clear selection
          window.getSelection()?.removeAllRanges();
        }
      } else {
        // Normal editor drop
        if (editorRef.current && draggedFragment.current && dropCursorPos) {
          // Only delete old selection if NOT duplicating
          if (!isDuplicating) {
            // Delete the content and normalize spaces
            const rangeToDelete = savedRange.current;
            
            // Check for spaces before and after the selection
            const beforeRange = document.createRange();
            beforeRange.setStart(rangeToDelete.startContainer, Math.max(0, rangeToDelete.startOffset - 1));
            beforeRange.setEnd(rangeToDelete.startContainer, rangeToDelete.startOffset);
            const charBefore = beforeRange.toString();
            
            const afterRange = document.createRange();
            const endContainer = rangeToDelete.endContainer;
            const maxOffset = endContainer.nodeType === Node.TEXT_NODE 
              ? (endContainer.textContent?.length || 0) 
              : endContainer.childNodes.length;
            afterRange.setStart(rangeToDelete.endContainer, rangeToDelete.endOffset);
            afterRange.setEnd(rangeToDelete.endContainer, Math.min(maxOffset, rangeToDelete.endOffset + 1));
            const charAfter = afterRange.toString();
            
            const hasSpaceBefore = /\s/.test(charBefore);
            const hasSpaceAfter = /\s/.test(charAfter);
            
            // Delete the selection
            rangeToDelete.deleteContents();
            
            // If there were spaces on both sides, normalize to a single space
            if (hasSpaceBefore && hasSpaceAfter) {
              // Delete one of the spaces
              const normalizeRange = document.createRange();
              const container = rangeToDelete.startContainer;
              const offset = rangeToDelete.startOffset;
              
              if (container.nodeType === Node.TEXT_NODE && container.textContent) {
                // Check if there are multiple spaces and reduce to one
                const text = container.textContent;
                const beforeText = text.substring(0, offset);
                const afterText = text.substring(offset);
                
                const trimmedBefore = beforeText.replace(/\s+$/, ' ');
                const trimmedAfter = afterText.replace(/^\s+/, '');
                
                if (beforeText !== trimmedBefore || afterText !== trimmedAfter) {
                  const newText = trimmedBefore + trimmedAfter;
                  container.textContent = newText;
                }
              }
            }
          }
          
          // Get all actual line positions to determine how many lines below we're dropping
          const lines: { top: number; bottom: number }[] = [];
          const walker = document.createTreeWalker(
            editorRef.current,
            NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
            null
          );
          
          const seenLines = new Set<number>();
          let node;
          while (node = walker.nextNode()) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
              const range = document.createRange();
              range.selectNodeContents(node);
              const rects = range.getClientRects();
              
              for (let i = 0; i < rects.length; i++) {
                const rect = rects[i];
                const lineKey = Math.round(rect.top);
                if (!seenLines.has(lineKey)) {
                  seenLines.add(lineKey);
                  lines.push({
                    top: rect.top,
                    bottom: rect.bottom
                  });
                }
              }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              if (element.matches && element.matches('h1, h2, h3, h4, h5, h6, p, div, li')) {
                const rect = element.getBoundingClientRect();
                if (rect.height > 0) {
                  const lineKey = Math.round(rect.top);
                  if (!seenLines.has(lineKey)) {
                    seenLines.add(lineKey);
                    lines.push({
                      top: rect.top,
                      bottom: rect.bottom
                    });
                  }
                }
              }
            }
          }
          
          lines.sort((a, b) => a.top - b.top);
          const lastLine = lines[lines.length - 1];
          
          // Check if we're dropping below the last line
          const isBelowContent = lastLine && dropCursorPos.y > lastLine.bottom + 10;
          
          if (isBelowContent) {
            // Calculate how many lines below we're dropping
            const avgLineHeight = lastLine.bottom - lastLine.top;
            const distanceBelow = dropCursorPos.y - lastLine.bottom;
            const linesBelow = Math.round(distanceBelow / avgLineHeight);
            
            // Create a range at the end of the editor
            const range = document.createRange();
            const lastChild = editorRef.current.lastChild;
            
            if (lastChild) {
              if (lastChild.nodeType === Node.TEXT_NODE) {
                range.setStart(lastChild, lastChild.textContent?.length || 0);
              } else {
                range.setStartAfter(lastChild);
              }
            } else {
              range.setStart(editorRef.current, 0);
            }
            range.collapse(true);
            
            // Insert line breaks to create the gap
            for (let i = 0; i < linesBelow; i++) {
              const br = document.createElement('br');
              range.insertNode(br);
              range.setStartAfter(br);
            }
            
            // Clone the fragment to insert
            const fragmentToInsert = draggedFragment.current.cloneNode(true) as DocumentFragment;
            const wrapper = document.createDocumentFragment();
            const nodesToInsert: Node[] = [];
            
            while (fragmentToInsert.firstChild) {
              nodesToInsert.push(fragmentToInsert.firstChild);
              fragmentToInsert.removeChild(fragmentToInsert.firstChild);
            }
            
            nodesToInsert.forEach(node => {
              wrapper.appendChild(node);
            });
            
            // Insert at the end
            range.insertNode(wrapper);
          } else {
            // Normal drop within existing content
            let range = document.caretRangeFromPoint(e.clientX, e.clientY);
            
            if (range && editorRef.current && draggedFragment.current) {
              // Check if we need to add spaces around the dropped content
              const container = range.startContainer;
              const offset = range.startOffset;
              
              // Check the character before the drop position
              let charBefore = '';
              if (container.nodeType === Node.TEXT_NODE && offset > 0) {
                charBefore = container.textContent?.charAt(offset - 1) || '';
              } else if (container.nodeType === Node.ELEMENT_NODE && offset > 0) {
                const prevNode = container.childNodes[offset - 1];
                if (prevNode && prevNode.nodeType === Node.TEXT_NODE) {
                  charBefore = prevNode.textContent?.charAt(prevNode.textContent.length - 1) || '';
                }
              }
              
              // Check the character after the drop position
              let charAfter = '';
              if (container.nodeType === Node.TEXT_NODE && container.textContent) {
                charAfter = container.textContent.charAt(offset) || '';
              } else if (container.nodeType === Node.ELEMENT_NODE) {
                const nextNode = container.childNodes[offset];
                if (nextNode && nextNode.nodeType === Node.TEXT_NODE) {
                  charAfter = nextNode.textContent?.charAt(0) || '';
                }
              }
              
              const needsSpaceBefore = charBefore && !/\s/.test(charBefore);
              const needsSpaceAfter = charAfter && !/\s/.test(charAfter);
              
              // Check if the dragged content has spaces at its edges
              const draggedText = draggedContent.trim();
              const hasLeadingSpace = draggedContent.startsWith(' ') || draggedContent.startsWith('\n');
              const hasTrailingSpace = draggedContent.endsWith(' ') || draggedContent.endsWith('\n');
              
              // Clone the fragment to insert
              const fragmentToInsert = draggedFragment.current.cloneNode(true) as DocumentFragment;
              const wrapper = document.createDocumentFragment();
              
              // Add leading space if needed
              if (needsSpaceBefore && !hasLeadingSpace) {
                wrapper.appendChild(document.createTextNode(' '));
              }
              
              // Add the dragged content
              const nodesToInsert: Node[] = [];
              while (fragmentToInsert.firstChild) {
                nodesToInsert.push(fragmentToInsert.firstChild);
                fragmentToInsert.removeChild(fragmentToInsert.firstChild);
              }
              
              nodesToInsert.forEach(node => {
                wrapper.appendChild(node);
              });
              
              // Add trailing space if needed
              if (needsSpaceAfter && !hasTrailingSpace) {
                wrapper.appendChild(document.createTextNode(' '));
              }
              
              // Insert at the drop position
              range.insertNode(wrapper);
            }
          }
          
          // Clear selection
          window.getSelection()?.removeAllRanges();
        }
      }
      
      // Reset state
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
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    // If clicking outside selection (and not dragging), allow normal behavior
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && !isClickInSelection(e.clientX, e.clientY)) {
      // Let the browser handle deselection naturally
    }
  };

  const insertStyledText = (text: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return;
    
    const range = selection.getRangeAt(0);
    
    // Clear placeholder if it exists and user is typing
    if (editorRef.current) {
      const firstChild = editorRef.current.firstElementChild;
      if (firstChild && firstChild.tagName === 'P') {
        const textContent = firstChild.textContent?.trim();
        const computedStyle = window.getComputedStyle(firstChild);
        const isGray = computedStyle.color === 'rgb(110, 110, 110)' || computedStyle.color === '#6e6e6e';
        const isInter = computedStyle.fontFamily.includes('Inter');
        const is18px = computedStyle.fontSize === '18px';
        
        if (textContent === 'Start writing...' && isGray && isInter && is18px) {
          editorRef.current.innerHTML = '';
          // Create a new range at the start of the editor
          const newRange = document.createRange();
          newRange.setStart(editorRef.current, 0);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          // Update the range reference
          range.setStart(editorRef.current, 0);
          range.collapse(true);
        }
      }
    }
    
    // Delete any selected text first
    if (!range.collapsed) {
      range.deleteContents();
    }
    
    // Check if we're at the end of a styled span and can append to it
    let targetSpan: HTMLElement | null = null;
    let canAppend = false;
    
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const textNode = range.startContainer as Text;
      const parent = textNode.parentElement;
      
      if (parent && parent.tagName === 'SPAN' && isHumanTextSpan(parent)) {
        // Check if we're at the end of the text node
        const offset = range.startOffset;
        const textLength = textNode.textContent?.length || 0;
        if (offset === textLength) {
          targetSpan = parent;
          canAppend = true;
        }
      }
    }
    
    // If we can append to existing styled span, do that
    if (targetSpan && canAppend) {
      const lastChild = targetSpan.lastChild;
      if (lastChild && lastChild.nodeType === Node.TEXT_NODE) {
        lastChild.textContent = (lastChild.textContent || '') + text;
      } else {
        targetSpan.appendChild(document.createTextNode(text));
      }
      
      // Move cursor after the inserted text
      const newRange = document.createRange();
      newRange.selectNodeContents(targetSpan);
      newRange.collapse(false);
      selection.removeAllRanges();
      selection.addRange(newRange);
    } else {
      // Get the computed line-height from the parent
      const parentElement = range.startContainer.nodeType === Node.TEXT_NODE
        ? (range.startContainer as Text).parentElement
        : range.startContainer as HTMLElement;
      let lineHeight = '1'; // Use 1 to minimize line height impact
      
      if (parentElement) {
        const computedStyle = window.getComputedStyle(parentElement);
        const parentLineHeight = computedStyle.lineHeight;
        const parentFontSize = parseFloat(computedStyle.fontSize);
        
        // Calculate line-height that maintains the same total line height
        if (parentLineHeight && parentFontSize && !isNaN(parentFontSize)) {
          const lineHeightPx = parseFloat(parentLineHeight);
          if (!isNaN(lineHeightPx)) {
            // Calculate what line-height we need for 20px font to match parent's total line height
            // If parent has 16px font with 1.5 line-height = 24px total
            // We want 20px font with X line-height = 24px total
            // So X = 24 / 20 = 1.2
            const targetLineHeightPx = lineHeightPx; // Keep same total line height
            const ourFontSize = 20;
            const calculatedLineHeight = targetLineHeightPx / ourFontSize;
            lineHeight = String(calculatedLineHeight);
          }
        } else if (parentLineHeight && !parentLineHeight.includes('px')) {
          // Unitless - calculate to maintain same total height
          const unitless = parseFloat(parentLineHeight);
          if (!isNaN(unitless) && parentFontSize) {
            const targetLineHeightPx = unitless * parentFontSize;
            const ourFontSize = 20;
            const calculatedLineHeight = targetLineHeightPx / ourFontSize;
            lineHeight = String(calculatedLineHeight);
          } else {
            lineHeight = parentLineHeight;
          }
        }
      }
      
      // Create a new span with human text styling (black Garamond 20pt)
      const span = createHumanTextSpan(text, lineHeight);
      
      // Insert the styled span
      range.insertNode(span);
      
      // Move cursor after the inserted text
      range.setStartAfter(span);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const ctrlKey = isMac ? e.metaKey : e.ctrlKey;

    // AI Review - Ctrl/Cmd + Enter
    if (ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleAiReview();
      return;
    }

    // Handle printable characters (but not with modifiers)
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
    
    // Only handle text insertion events
    if (inputEvent.inputType === 'insertText' || inputEvent.inputType === 'insertCompositionText') {
      const textToInsert = inputEvent.data || '';
      
      if (!textToInsert) return;
      
      // Prevent default insertion
      e.preventDefault();
      
      // Insert with our styled handler
      insertStyledText(textToInsert);
    }
  };


  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    
    const selection = window.getSelection();
    if (!selection || !editorRef.current) return;

    const pastedText = e.clipboardData.getData('text/plain');
    
    if (!pastedText) return;

    // Append pasted content after the last *meaningful* node (ignore trailing empty lines/blocks)
    const editorElement = editorRef.current;
    const getLastMeaningfulNode = (): Node | null => {
      let current: ChildNode | null = editorElement.lastChild;

      while (current) {
        if (current.nodeType === Node.TEXT_NODE) {
          const text = current.textContent ?? '';
          if (text.trim() !== '') return current;
          current = current.previousSibling;
          continue;
        }

        if (current.nodeType === Node.ELEMENT_NODE) {
          const el = current as HTMLElement;
          const tag = el.tagName.toUpperCase();

          // Ignore pure <br> nodes
          if (tag === 'BR') {
            current = current.previousSibling;
            continue;
          }

          // Ignore placeholder or empty paragraphs/spacers at the end
          const text = (el.textContent ?? '').replace(/\u200B/g, '').trim();
          const hasMedia = Boolean(el.querySelector?.('img,video,iframe,svg,canvas'));
          const isPlaceholder = text === 'Start writing...';
          const isEmptyParagraph = tag === 'P' && !hasMedia && text === '';

          if (isPlaceholder || isEmptyParagraph || (!hasMedia && text === '')) {
            current = current.previousSibling;
            continue;
          }

          return el;
        }

        current = current.previousSibling;
      }

      return null;
    };

    const insertAfterNode = getLastMeaningfulNode();
    const range = document.createRange();
    if (insertAfterNode) {
      range.setStartAfter(insertAfterNode);
    } else {
      range.setStart(editorElement, 0);
    }
    range.collapse(true);

    // If the user pastes a single URL, insert an embed preview card instead of raw text.
    const trimmed = pastedText.trim();
    if (isProbablyUrl(trimmed)) {
      const card = buildLinkPreviewCard(trimmed);

      // Insert as a block (avoid nesting inside spans)
      const block = document.createElement('div');
      block.appendChild(card);
      const spacer = document.createElement('p');
      spacer.appendChild(document.createElement('br'));
      block.appendChild(spacer);

      range.insertNode(block);

      // Move cursor to the end after the inserted block
      const newRange = document.createRange();
      newRange.setStartAfter(block);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);

      hydrateLinkPreviewCard(card, trimmed);
      return;
    }
    
    // Get the computed line-height from the parent
    const parentElement = range.startContainer.nodeType === Node.TEXT_NODE
      ? (range.startContainer as Text).parentElement
      : range.startContainer as HTMLElement;
    let lineHeight = '1'; // Use 1 to minimize line height impact
    
    if (parentElement) {
      const computedStyle = window.getComputedStyle(parentElement);
      const parentLineHeight = computedStyle.lineHeight;
      const parentFontSize = parseFloat(computedStyle.fontSize);
      
      // Calculate line-height that maintains the same total line height
      if (parentLineHeight && parentFontSize && !isNaN(parentFontSize)) {
        const lineHeightPx = parseFloat(parentLineHeight);
        if (!isNaN(lineHeightPx)) {
          // Calculate what line-height we need for 20px font to match parent's total line height
          const targetLineHeightPx = lineHeightPx; // Keep same total line height
          const ourFontSize = 20;
          const calculatedLineHeight = targetLineHeightPx / ourFontSize;
          lineHeight = String(calculatedLineHeight);
        }
      } else if (parentLineHeight && !parentLineHeight.includes('px')) {
        // Unitless - calculate to maintain same total height
        const unitless = parseFloat(parentLineHeight);
        if (!isNaN(unitless) && parentFontSize) {
          const targetLineHeightPx = unitless * parentFontSize;
          const ourFontSize = 20;
          const calculatedLineHeight = targetLineHeightPx / ourFontSize;
          lineHeight = String(calculatedLineHeight);
        } else {
          lineHeight = parentLineHeight;
        }
      }
    }
    
    // Create a span with human text styling (black Garamond 20pt) for pasted text
    const span = createHumanTextSpan('', lineHeight);
    
    // Preserve line breaks by converting them to <br> tags
    const lines = pastedText.split('\n');
    lines.forEach((line, index) => {
      if (index > 0) {
        span.appendChild(document.createElement('br'));
      }
      if (line) {
        span.appendChild(document.createTextNode(line));
      }
    });
    
    // Insert the styled span
    range.insertNode(span);
    
    // Move cursor to the end after the pasted content
    const newRange = document.createRange();
    newRange.setStartAfter(span);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);
  };

  const handleMarginTextPositionChange = (id: string, x: number, y: number) => {
    setMarginTexts(prev => prev.map(m => m.id === id ? { ...m, x, y } : m));
  };

  const handleMarginTextDelete = (id: string) => {
    setMarginTexts(prev => prev.filter(m => m.id !== id));
  };

  const handleMarginTextContentChange = (id: string, htmlContent: string) => {
    setMarginTexts(prev => prev.map(m => m.id === id ? { ...m, htmlContent } : m));
  };

  const handleMarginTextExpand = (id: string) => {
    const marginText = marginTexts.find(m => m.id === id);
    if (!marginText || !editorRef.current) return;
    
    // Set the editor content to the margin text's HTML content
    editorRef.current.innerHTML = marginText.htmlContent;
    
    // Remove the margin text from the margin
    setMarginTexts(prev => prev.filter(m => m.id !== id));
    
    // Focus the editor
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

    const handleMouseUp = () => {
      setIsResizingMargin(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
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
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-2 py-2">
        <div className="w-full mx-auto flex gap-0.5 items-center text-gray-400">
          {/* Text formatting */}
          <button
            onClick={() => handleFormat('bold')}
            className="p-1.5 hover:text-gray-700 transition-colors"
            title="Bold (Ctrl/Cmd+B)"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleFormat('italic')}
            className="p-1.5 hover:text-gray-700 transition-colors"
            title="Italic (Ctrl/Cmd+I)"
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleFormat('underline')}
            className="p-1.5 hover:text-gray-700 transition-colors"
            title="Underline (Ctrl/Cmd+U)"
          >
            <Underline className="w-4 h-4" />
          </button>

          <div className="w-3" />

          {/* Lists */}
          <button
            onClick={() => handleFormat('insertUnorderedList')}
            className="p-1.5 hover:text-gray-700 transition-colors"
            title="Bullet List"
          >
            <List className="w-4 h-4" style={{ transform: 'scale(1.1)' }} />
          </button>
          <button
            onClick={() => handleFormat('insertOrderedList')}
            className="p-1.5 hover:text-gray-700 transition-colors"
            title="Numbered List"
          >
            <ListOrdered className="w-4 h-4" style={{ transform: 'scale(1.1)' }} />
          </button>

          <div className="w-3" />

          {/* AI actions � Gemini (low-cost model) */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="p-1.5 hover:text-gray-700 transition-colors disabled:opacity-50"
                title="AI: Summarize, improve, or expand selection"
                disabled={aiLoading}
                aria-label="AI actions"
              >
                {aiLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="w-4 h-4" aria-hidden />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-2">
              <p className="text-xs text-gray-500 mb-2 px-1">Select text, then:</p>
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  className="text-left text-sm px-2 py-1.5 rounded hover:bg-gray-100"
                  onClick={() => handleAiAction('summarize')}
                  disabled={aiLoading}
                >
                  Summarize
                </button>
                <button
                  type="button"
                  className="text-left text-sm px-2 py-1.5 rounded hover:bg-gray-100"
                  onClick={() => handleAiAction('improve')}
                  disabled={aiLoading}
                >
                  Improve writing
                </button>
                <button
                  type="button"
                  className="text-left text-sm px-2 py-1.5 rounded hover:bg-gray-100"
                  onClick={() => handleAiAction('expand')}
                  disabled={aiLoading}
                >
                  Expand
                </button>
              </div>
              {aiError && (
                <p className="text-xs text-red-600 mt-2 px-1 break-words" role="alert">
                  {aiError}
                </p>
              )}
            </PopoverContent>
          </Popover>

          <div className="ml-2 flex items-center gap-2">
            <label htmlFor="model-select" className="text-xs text-gray-500">
              Model
            </label>
            <select
              id="model-select"
              value={OPENAI_MODEL_OPTIONS.includes(selectedModel) ? selectedModel : OPENAI_MODEL_OPTIONS[0]}
              onChange={handleModelChange}
              className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Select AI model"
            >
              {OPENAI_MODEL_OPTIONS.map((modelId) => (
                <option key={modelId} value={modelId}>
                  {modelId}
                </option>
              ))}
            </select>
          </div>

          {isBusy && (
            <div className="ml-2 flex items-center gap-1 text-xs text-gray-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              <span>{isSearching ? 'Searching...' : 'Thinking...'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Shortcuts Panel */}
      {showShortcuts && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold">Keyboard Shortcuts</h2>
              <button
                onClick={() => setShowShortcuts(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ?
              </button>
            </div>
            <div className="space-y-2">
              {shortcuts.map((shortcut, index) => (
                <div key={index} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-b-0">
                  <span className="text-gray-700">{shortcut.action}</span>
                  <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">
                    {shortcut.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Drop Cursor Indicator */}
      {dropCursorPos && dragTarget === 'editor' && (
        <div
          className="fixed w-0.5 h-5 bg-blue-500 pointer-events-none z-50"
          style={{
            left: `${dropCursorPos.x}px`,
            top: `${dropCursorPos.y}px`,
          }}
        />
      )}

      {/* Dragged Text Element */}
      {dragElementPos && draggedContent && (
        <div
          className={`fixed pointer-events-none z-50 text-white px-2 py-1 rounded text-sm max-w-xs truncate shadow-lg ${
            isDuplicating ? 'bg-green-500' : 'bg-blue-500'
          }`}
          style={{
            left: `${dragElementPos.x + 10}px`,
            top: `${dragElementPos.y + 10}px`,
          }}
        >
          {isDuplicating && <span className="mr-1">+</span>}
          {draggedContent}
        </div>
      )}

      {/* Additional Selection Highlights */}
      {additionalSelections.map((range, index) => {
        const rects = range.getClientRects();
        return (Array.from(rects) as DOMRect[]).map((rect, rectIndex) => (
          <div
            key={`${index}-${rectIndex}`}
            className="fixed pointer-events-none bg-blue-200/40 z-40"
            style={{
              left: `${rect.left}px`,
              top: `${rect.top}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
            }}
          />
        ));
      })}

      {/* Main Container */}
      <div
        ref={containerRef}
        className="relative max-w-7xl mx-auto flex overflow-hidden"
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
      >
        {/* Left Margin (only when marginSide === 'left') */}
        {marginSide === 'left' && (
          <>
            <div 
              className="relative flex-shrink-0 overflow-hidden" 
              style={{ width: `${marginWidth}px`, height: 'calc(100vh - 48px)' }}
            >
              {/* Switch Handle */}
              <button
                onClick={handleSwitchMarginSide}
                className="absolute top-2 right-2 z-20 p-1.5 bg-white hover:bg-gray-100 rounded shadow-sm border border-gray-200"
                title="Switch to right margin"
              >
                <MoveHorizontal className="w-4 h-4 text-gray-600" />
              </button>

              {/* Margin Content */}
              {marginTexts.map(m => (
                <MarginText
                  key={m.id}
                  id={m.id}
                  content={m.content}
                  htmlContent={m.htmlContent}
                  x={m.x}
                  y={m.y}
                  onPositionChange={handleMarginTextPositionChange}
                  onDelete={() => handleMarginTextDelete(m.id)}
                  onContentChange={handleMarginTextContentChange}
                  onExpand={() => handleMarginTextExpand(m.id)}
                />
              ))}
            </div>

            {/* Left Divider */}
            {hasMarginContent && (
              <div 
                className="relative flex-shrink-0 group"
                onMouseDown={handleDividerMouseDown}
              >
                <div className="absolute inset-0 w-4 -ml-2 cursor-col-resize z-10" />
                <div className="h-full w-px bg-gray-300 group-hover:bg-gray-500 transition-colors">
                  <Vector59 />
                </div>
              </div>
            )}
          </>
        )}

        {/* Editor */}
        <div className="flex-1 min-w-0 overflow-auto">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            className="min-h-screen bg-white p-8 focus:outline-none prose prose-lg max-w-3xl mx-auto font-normal"
            spellCheck
            onMouseDown={handleMouseDown}
            onClick={handleClick}
            onKeyDown={handleEditorKeyDown}
            onBeforeInput={handleBeforeInput}
            onPaste={handlePaste}
          >
            <p className="text-[#6e6e6e]" style={{ fontFamily: 'Inter, sans-serif', fontSize: '18px', fontWeight: 350, fontVariationSettings: '"wght" 350' }}>
              Start writing...
            </p>
          </div>
        </div>

        {/* Right Margin (only when marginSide === 'right') */}
        {marginSide === 'right' && (
          <>
            {/* Right Divider */}
            {hasMarginContent && (
              <div 
                className="relative flex-shrink-0 group"
                onMouseDown={handleDividerMouseDown}
              >
                <div className="absolute inset-0 w-4 -ml-2 cursor-col-resize z-10" />
                <div className="h-full w-px bg-gray-300 group-hover:bg-gray-500 transition-colors">
                  <Vector59 />
                </div>
              </div>
            )}

            <div 
              className="relative flex-shrink-0 overflow-hidden" 
              style={{ width: `${marginWidth}px`, height: 'calc(100vh - 48px)' }}
            >
              {/* Switch Handle */}
              <button
                onClick={handleSwitchMarginSide}
                className="absolute top-2 left-2 z-20 p-1.5 bg-white hover:bg-gray-100 rounded shadow-sm border border-gray-200"
                title="Switch to left margin"
              >
                <MoveHorizontal className="w-4 h-4 text-gray-600" />
              </button>

              {/* Margin Content */}
              {marginTexts.map(m => (
                <MarginText
                  key={m.id}
                  id={m.id}
                  content={m.content}
                  htmlContent={m.htmlContent}
                  x={m.x}
                  y={m.y}
                  onPositionChange={handleMarginTextPositionChange}
                  onDelete={() => handleMarginTextDelete(m.id)}
                  onContentChange={handleMarginTextContentChange}
                  onExpand={() => handleMarginTextExpand(m.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}