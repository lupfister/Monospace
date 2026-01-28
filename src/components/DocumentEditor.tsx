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
import { generateWithGemini, type GeminiAction } from '../lib/gemini';
import { createHumanTextSpan, createAiTextSpan, isHumanTextSpan } from '../lib/textStyles';
import { type WebSearchResults, parseSearchResults } from '../lib/webSearch';
import { searchForContent, performWebSearch } from '../lib/searchAPI';
import { getLinkPreview, isProbablyUrl, type LinkPreviewData } from '../lib/linkPreviews';

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


  const insertSearchResultsInline = useCallback(async (
    results: WebSearchResults,
    selection: Selection
  ) => {
    if (!editorRef.current || !selection) {
      console.error('Cannot insert: editorRef or selection is null');
      return;
    }
    
    console.log('insertSearchResultsInline called with:', results);

    // Get insertion point (similar to AI review)
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    if (!range) return;

    let insertAfterElement: Node | null = null;
    let container: Node = range.startContainer;
    if (container.nodeType === Node.TEXT_NODE) {
      container = container.parentElement || container;
    }

    // Find block element to insert after
    let blockElement: HTMLElement | null = null;
    let current: Node | null = container as Node;
    
    while (current && current !== editorRef.current) {
      if (current.nodeType === Node.ELEMENT_NODE) {
        const el = current as HTMLElement;
        if (el.tagName === 'P' || el.tagName === 'DIV' || 
            el.tagName.match(/^H[1-6]$/) || el.tagName === 'LI') {
          blockElement = el;
          break;
        }
      }
      current = current.parentNode;
    }

    insertAfterElement = blockElement || container;

    try {
      const sel = window.getSelection();
      if (!sel || !editorRef.current || !insertAfterElement) return;

      const insertRange = document.createRange();
      
      if (insertAfterElement.parentNode) {
        insertRange.setStartAfter(insertAfterElement);
        insertRange.collapse(true);
      } else {
        insertRange.selectNodeContents(editorRef.current);
        insertRange.collapse(false);
      }

      // Create container for search results
      const resultsContainer = document.createElement('div');
      resultsContainer.style.marginTop = '16px';
      resultsContainer.style.marginBottom = '16px';
      resultsContainer.style.padding = '16px';
      resultsContainer.style.borderLeft = '3px solid #3b82f6';
      resultsContainer.style.backgroundColor = '#f8fafc';
      resultsContainer.style.borderRadius = '4px';

      // Add header
      const header = document.createElement('div');
      header.style.marginBottom = '12px';
      header.style.fontSize = '14px';
      header.style.fontWeight = '600';
      header.style.color = '#1e293b';
      header.textContent = '?? Search Results';
      resultsContainer.appendChild(header);

      // Add YouTube videos
      if (results.videos.length > 0) {
        const videosSection = document.createElement('div');
        videosSection.style.marginBottom = '16px';
        
        const videosTitle = document.createElement('div');
        videosTitle.style.fontSize = '13px';
        videosTitle.style.fontWeight = '600';
        videosTitle.style.color = '#dc2626';
        videosTitle.style.marginBottom = '8px';
        videosTitle.textContent = '?? YouTube Videos';
        videosSection.appendChild(videosTitle);

        results.videos.slice(0, 3).forEach((video) => {
          const videoItem = document.createElement('div');
          videoItem.style.marginBottom = '12px';
          videoItem.style.padding = '8px';
          videoItem.style.backgroundColor = 'white';
          videoItem.style.borderRadius = '4px';
          videoItem.style.border = '1px solid #e2e8f0';

          const videoLink = document.createElement('a');
          videoLink.href = video.url;
          videoLink.target = '_blank';
          videoLink.rel = 'noopener noreferrer';
          videoLink.style.textDecoration = 'none';
          videoLink.style.color = '#2563eb';
          videoLink.style.fontSize = '13px';
          videoLink.style.fontWeight = '500';
          videoLink.textContent = video.title;
          videoItem.appendChild(videoLink);

          if (video.snippet) {
            const snippet = document.createElement('div');
            snippet.style.fontSize = '12px';
            snippet.style.color = '#64748b';
            snippet.style.marginTop = '4px';
            snippet.textContent = video.snippet.substring(0, 150) + (video.snippet.length > 150 ? '...' : '');
            videoItem.appendChild(snippet);
          }

          const urlText = document.createElement('div');
          urlText.style.fontSize = '11px';
          urlText.style.color = '#94a3b8';
          urlText.style.marginTop = '4px';
          urlText.textContent = video.url;
          videoItem.appendChild(urlText);

          videosSection.appendChild(videoItem);
        });

        resultsContainer.appendChild(videosSection);
      }

      // Add Articles
      if (results.articles.length > 0) {
        const articlesSection = document.createElement('div');
        articlesSection.style.marginBottom = '16px';
        
        const articlesTitle = document.createElement('div');
        articlesTitle.style.fontSize = '13px';
        articlesTitle.style.fontWeight = '600';
        articlesTitle.style.color = '#2563eb';
        articlesTitle.style.marginBottom = '8px';
        articlesTitle.textContent = '?? Articles';
        articlesSection.appendChild(articlesTitle);

        results.articles.slice(0, 3).forEach((article) => {
          const articleItem = document.createElement('div');
          articleItem.style.marginBottom = '12px';
          articleItem.style.padding = '8px';
          articleItem.style.backgroundColor = 'white';
          articleItem.style.borderRadius = '4px';
          articleItem.style.border = '1px solid #e2e8f0';

          const articleLink = document.createElement('a');
          articleLink.href = article.url;
          articleLink.target = '_blank';
          articleLink.rel = 'noopener noreferrer';
          articleLink.style.textDecoration = 'none';
          articleLink.style.color = '#2563eb';
          articleLink.style.fontSize = '13px';
          articleLink.style.fontWeight = '500';
          articleLink.textContent = article.title;
          articleItem.appendChild(articleLink);

          if (article.snippet) {
            const snippet = document.createElement('div');
            snippet.style.fontSize = '12px';
            snippet.style.color = '#64748b';
            snippet.style.marginTop = '4px';
            snippet.textContent = article.snippet.substring(0, 150) + (article.snippet.length > 150 ? '...' : '');
            articleItem.appendChild(snippet);
          }

          const urlText = document.createElement('div');
          urlText.style.fontSize = '11px';
          urlText.style.color = '#94a3b8';
          urlText.style.marginTop = '4px';
          urlText.textContent = article.url;
          articleItem.appendChild(urlText);

          articlesSection.appendChild(articleItem);
        });

        resultsContainer.appendChild(articlesSection);
      }

      // Add Images
      if (results.images.length > 0) {
        const imagesSection = document.createElement('div');
        imagesSection.style.marginBottom = '16px';
        
        const imagesTitle = document.createElement('div');
        imagesTitle.style.fontSize = '13px';
        imagesTitle.style.fontWeight = '600';
        imagesTitle.style.color = '#16a34a';
        imagesTitle.style.marginBottom = '8px';
        imagesTitle.textContent = '??? Images';
        imagesSection.appendChild(imagesTitle);

        const imagesGrid = document.createElement('div');
        imagesGrid.style.display = 'grid';
        imagesGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))';
        imagesGrid.style.gap = '8px';

        results.images.slice(0, 6).forEach((image) => {
          const imageItem = document.createElement('a');
          imageItem.href = image.url;
          imageItem.target = '_blank';
          imageItem.rel = 'noopener noreferrer';
          imageItem.style.display = 'block';
          imageItem.style.textDecoration = 'none';

          const img = document.createElement('img');
          img.src = image.thumbnail || image.url;
          img.alt = image.title || 'Image';
          img.style.width = '100%';
          img.style.height = '120px';
          img.style.objectFit = 'cover';
          img.style.borderRadius = '4px';
          img.style.border = '1px solid #e2e8f0';
          img.onerror = () => {
            img.style.display = 'none';
          };

          imageItem.appendChild(img);
          imagesGrid.appendChild(imageItem);
        });

        imagesSection.appendChild(imagesGrid);
        resultsContainer.appendChild(imagesSection);
      }

      // If no results, show message
      if (results.videos.length === 0 && results.articles.length === 0 && results.images.length === 0) {
        const noResults = document.createElement('div');
        noResults.style.fontSize = '13px';
        noResults.style.color = '#64748b';
        noResults.style.fontStyle = 'italic';
        noResults.textContent = 'No results found. Try a different search query.';
        resultsContainer.appendChild(noResults);
      }

      // Insert the results container
      console.log('Inserting results container with', results.videos.length, 'videos,', results.articles.length, 'articles,', results.images.length, 'images');
      insertRange.insertNode(resultsContainer);

      // Add spacing after
      const br = document.createElement('br');
      insertRange.setStartAfter(resultsContainer);
      insertRange.collapse(true);
      insertRange.insertNode(br);

      // Move cursor after the inserted content
      insertRange.setStartAfter(br);
      insertRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(insertRange);

      editorRef.current?.focus();
      console.log('Results inserted successfully!');
    } catch (error) {
      console.error('Error inserting results:', error);
      setAiError('Could not insert search results. ' + (error instanceof Error ? error.message : String(error)));
    }
  }, [setAiError]);

  const handleAiReview = useCallback(async () => {
    const selection = window.getSelection();
    if (!selection || !editorRef.current) return;

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

    // Get text to review from the block element
    let textToReview = '';
    let insertAfterElement: Node | null = null;

    if (blockElement) {
      // Get all text from the block element
      const textRange = document.createRange();
      textRange.selectNodeContents(blockElement);
      textToReview = textRange.toString().trim();
      insertAfterElement = blockElement;
    } else {
      // Fallback: if no block element, we need to get ALL text from the editor
      // This handles cases where text is in spans without a paragraph wrapper
      
      // First, try to find the closest containing element that has text
      let startNode: Node = range.startContainer;
      let containingElement: HTMLElement | null = null;
      
      // Walk up to find any element that contains text
      let current: Node | null = startNode;
      while (current && current !== editorRef.current) {
        if (current.nodeType === Node.ELEMENT_NODE) {
          const el = current as HTMLElement;
          const textContent = el.textContent?.trim() || '';
          if (textContent && textContent !== 'Start writing...') {
            containingElement = el;
            break;
          }
        }
        current = current.parentNode;
      }
      
      if (containingElement) {
        // Get all text from this containing element
        const textRange = document.createRange();
        textRange.selectNodeContents(containingElement);
        textToReview = textRange.toString().trim();
        insertAfterElement = containingElement;
      } else {
        // Last resort: get ALL text from the entire editor (excluding placeholder)
        // This ensures we get the full sentence even if structure is complex
        // Use innerText or textContent to get all text in document order
        let allText = editorRef.current.innerText || editorRef.current.textContent || '';
        
        // Remove placeholder text if present
        allText = allText.replace(/Start writing\.\.\./g, '').trim();
        
        textToReview = allText;
        
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

    if (!textToReview || textToReview === 'Start writing...') {
      setAiError('No text found to review. Please write something first.');
      return;
    }

    setAiError(null);
    setAiLoading(true);

    const result = await generateWithGemini('review', textToReview);
    setAiLoading(false);

    if (!result.ok) {
      setAiError(result.error);
      return;
    }

    // Parse AI response for search tags
    const searchTagMatch = result.text.match(/\[SEARCH_(VIDEOS|ARTICLES|IMAGES|ALL):\s*(.+?)\]/);
    let aiResponseText = result.text;
    let searchQuery: string | null = null;
    let searchType: 'video' | 'web' | 'image' | 'all' | null = null;

    if (searchTagMatch) {
      const [, type, query] = searchTagMatch;
      searchQuery = query.trim();
      aiResponseText = result.text.replace(/\[SEARCH_\w+:\s*.+?\]/g, '').trim();
      
      if (type === 'VIDEOS') {
        searchType = 'video';
      } else if (type === 'ARTICLES') {
        searchType = 'web';
      } else if (type === 'IMAGES') {
        searchType = 'image';
      } else if (type === 'ALL') {
        searchType = 'all';
      }
    }

    // Insert the AI review response below the reviewed text
    try {
      const sel = window.getSelection();
      if (!sel || !editorRef.current || !insertAfterElement) return;

      const insertRange = document.createRange();
      
      if (insertAfterElement.parentNode) {
        insertRange.setStartAfter(insertAfterElement);
        insertRange.collapse(true);
      } else {
        insertRange.selectNodeContents(editorRef.current);
        insertRange.collapse(false);
      }

      // Create a new paragraph for the AI response
      const p = document.createElement('p');
      const aiSpan = createAiTextSpan(aiResponseText);
      p.appendChild(aiSpan);

      insertRange.insertNode(p);

      // Add a line break after for spacing
      const br = document.createElement('br');
      insertRange.setStartAfter(p);
      insertRange.collapse(true);
      insertRange.insertNode(br);

      // Move cursor after the inserted content
      insertRange.setStartAfter(br);
      insertRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(insertRange);

      // If AI suggested a search, perform it automatically
      if (searchQuery && searchType) {
        console.log('AI suggested search:', searchType, searchQuery);
        setIsSearching(true);
        
        try {
          let results: WebSearchResults;
          
          if (searchType === 'all') {
            // Search for all types
            results = await searchForContent(searchQuery);
          } else if (searchType === 'video') {
            // Search only for videos
            const videoResults = await performWebSearch(`${searchQuery} site:youtube.com`, { type: 'video' }).catch(() => []);
            results = parseSearchResults(searchQuery, videoResults);
          } else if (searchType === 'web') {
            // Search only for articles
            const articleResults = await performWebSearch(searchQuery, { type: 'web' }).catch(() => []);
            results = parseSearchResults(searchQuery, articleResults);
          } else {
            // Search only for images
            const imageResults = await performWebSearch(searchQuery, { type: 'image' }).catch(() => []);
            results = parseSearchResults(searchQuery, imageResults);
          }

          // Insert search results after the AI response
          if (results.videos.length > 0 || results.articles.length > 0 || results.images.length > 0) {
            const freshSelection = window.getSelection();
            if (freshSelection) {
              // Create a new range after the AI response paragraph
              const resultsRange = document.createRange();
              resultsRange.setStartAfter(br);
              resultsRange.collapse(true);
              
              // Temporarily set selection to insert results
              freshSelection.removeAllRanges();
              freshSelection.addRange(resultsRange);
              
              await insertSearchResultsInline(results, freshSelection);
            }
          }
        } catch (searchError) {
          console.error('Auto-search failed:', searchError);
          // Don't show error to user - search is optional
        } finally {
          setIsSearching(false);
        }
      }
    } catch (error) {
      setAiError('Could not insert review. ' + (error instanceof Error ? error.message : String(error)));
    }

    editorRef.current?.focus();
  }, [setAiError, setAiLoading]);

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

    const result = await generateWithGemini(action, selectedText);
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
    }
    // If no saved content, the placeholder "Start writing..." is already in the JSX
  }, []);

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
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return;
    
    const range = selection.getRangeAt(0);
    const pastedText = e.clipboardData.getData('text/plain');
    
    if (!pastedText) return;

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

      // Move cursor into the spacer paragraph
      const newRange = document.createRange();
      newRange.selectNodeContents(spacer);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);

      hydrateLinkPreviewCard(card, trimmed);
      return;
    }
    
    // Delete any selected text first
    if (!range.collapsed) {
      range.deleteContents();
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
    
    // Move cursor after the pasted content
    range.setStartAfter(span);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
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