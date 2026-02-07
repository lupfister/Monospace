import { resultCardClasses, type ResultItem } from './searchResultItems';
import { isImageUrl } from './linkPreviews';
import { createAiTextBlock } from './domUtils';
import { createAiTextWithLinksFragment, createAiTextSpan, createStyledSourceLink } from './textStyles';
import type { SkeletonNotes, SkeletonNoteBlock, AiError } from './openaiAgentApi';


/**
 * RENDERER RULES:
 * 1. ALWAYS work with the text editing document paradigm.
 * 2. Avoid CSS-based gaps (margins/padding) for vertical rhythm. Use text flow, <br>, or empty lines.
 * 3. Maintain a consistent line-height of 1.5.
 * 4. Content should allow for natural cursor movement and text selection.
 */

// Loading phase type
export type LoadingPhase = 'planning' | 'searching' | 'generating';

const PHASE_MESSAGES: Record<LoadingPhase, string> = {
    planning: 'Understanding your text...',
    searching: 'Exploring sources...',
    generating: 'Crafting response...',
};

/**
 * Creates a shimmer loading indicator that appears in the document during AI review.
 * Shows horizontal shimmering lines with a phase message.
 */
export const createLoadingShimmer = (phase: LoadingPhase = 'planning'): HTMLDivElement => {
    const container = document.createElement('div');
    container.className = 'ai-loading-shimmer';
    container.dataset.loadingPhase = phase;
    container.contentEditable = 'false';
    container.style.cssText = `
    display: block;
    margin: 16px 0;
    padding: 12px 0;
    user-select: none;
    pointer-events: none;
  `;

    // Phase message
    const phaseText = document.createElement('div');
    phaseText.className = 'shimmer-phase-text';
    phaseText.textContent = PHASE_MESSAGES[phase];
    phaseText.style.cssText = `
    color: #6e6e6e;
    font-size: 13px;
    margin-bottom: 12px;
    font-style: italic;
    line-height: 1.5;
  `;
    container.appendChild(phaseText);

    // Shimmer lines (3 horizontal bars with random widths)
    for (let i = 0; i < 3; i++) {
        const line = document.createElement('div');
        line.className = 'shimmer-line';
        const width = 60 + Math.random() * 35; // 60-95% width for variety
        line.style.cssText = `
      height: 14px;
      width: ${width}%;
      background: linear-gradient(
        90deg,
        #f0f0f0 0%,
        #e0e0e0 20%,
        #f0f0f0 40%,
        #f0f0f0 100%
      );
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
      border-radius: 4px;
      margin-bottom: 8px;
    `;
        container.appendChild(line);
    }

    return container;
};

/**
 * Updates the phase message on an existing shimmer element.
 */
export const updateShimmerPhase = (shimmer: HTMLElement, phase: LoadingPhase): void => {
    shimmer.dataset.loadingPhase = phase;
    const phaseText = shimmer.querySelector('.shimmer-phase-text');
    if (phaseText) {
        phaseText.textContent = PHASE_MESSAGES[phase];
    }
};

/**
 * Creates an error block to display when AI review fails.
 */
export const createErrorBlock = (error: AiError): HTMLDivElement => {
    const container = document.createElement('div');
    container.className = 'ai-error-block';
    container.contentEditable = 'false';
    container.style.cssText = `
    padding: 12px 16px;
    background: #fef2f2;
    border-left: 3px solid #ef4444;
    border-radius: 4px;
    margin: 16px 0;
  `;

    const message = document.createElement('div');
    message.style.cssText = 'color: #dc2626; font-size: 14px; margin-bottom: 4px; line-height: 1.5;';
    message.textContent = error.message;
    container.appendChild(message);

    if (error.suggestion) {
        const suggestion = document.createElement('div');
        suggestion.style.cssText = 'color: #9ca3af; font-size: 12px; line-height: 1.5;';
        suggestion.textContent = error.suggestion;
        container.appendChild(suggestion);
    }

    return container;
};


export const createInlineResultCard = (item: ResultItem): DocumentFragment => {
    const fragment = document.createDocumentFragment();
    const isMedia = item.type === 'video' || item.type === 'image';

    if (item.type === 'image' || item.type === 'video') {
        const imageUrl = item.thumbnail || item.url || '';

        // 1. Media Line (Image/Video)
        if (imageUrl) {
            const mediaPara = document.createElement('p');
            mediaPara.style.lineHeight = '0'; // Tighter wrapping for media

            // Wrapper is still useful for relative positioning of play icon
            const mediaWrapper = document.createElement('span'); // Span to be inline-ish but effective
            mediaWrapper.contentEditable = 'false'; // IMPORTANT: Unit as a whole
            mediaWrapper.style.display = 'inline-block';
            mediaWrapper.style.position = 'relative';
            mediaWrapper.style.overflow = 'hidden';
            // mediaWrapper.style.borderRadius = '8px'; // Removed rounded corners
            mediaWrapper.style.maxWidth = '100%';
            mediaWrapper.style.verticalAlign = 'top'; // Align nicely with text flow if needed

            const img = document.createElement('img');
            if (isImageUrl(imageUrl)) {
                img.src = imageUrl;
            } else {
                const proxyUrl = `/api/ai/image?url=${encodeURIComponent(imageUrl)}`;
                img.src = proxyUrl;
            }
            if (item.url) img.dataset.fallbackUrl = item.url;
            img.alt = item.title || (item.type === 'video' ? 'Video thumbnail' : 'Image');

            // Standardize image styling, but without "card" background
            img.style.minHeight = '160px'; // Slightly smaller than card
            img.style.maxHeight = '400px';
            img.style.width = 'auto'; // allow natural aspect ratio? or 100%?
            img.style.maxWidth = '100%';
            img.style.objectFit = 'cover';
            img.style.backgroundColor = 'var(--color-gray-100, #f3f4f6)';
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';

            // On error, remove the wrapper (and thus the image)
            img.onerror = () => {
                const currentSrc = img.src;
                if (!currentSrc.includes('/api/ai/image')) {
                    img.src = `/api/ai/image?url=${encodeURIComponent(imageUrl)}`;
                    return;
                }
                if (mediaWrapper.parentNode) {
                    mediaWrapper.parentNode.removeChild(mediaWrapper);
                }
            };

            mediaWrapper.appendChild(img);

            // Add video play icon overlay for videos
            if (item.type === 'video') {
                const playIcon = document.createElement('div');
                playIcon.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="white" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
                    <circle cx="12" cy="12" r="10" fill="rgba(0,0,0,0.6)"/>
                    <path d="M10 8l6 4-6 4V8z" fill="white"/>
                </svg>`;
                playIcon.style.position = 'absolute';
                playIcon.style.top = '50%';
                playIcon.style.left = '50%';
                playIcon.style.transform = 'translate(-50%, -50%)';
                playIcon.style.pointerEvents = 'none';
                playIcon.style.opacity = '0.9';
                mediaWrapper.appendChild(playIcon);

                // Click behavior for video
                mediaWrapper.style.cursor = 'pointer';
                mediaWrapper.onclick = () => {
                    if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer');
                };
            }

            mediaPara.appendChild(mediaWrapper);
            fragment.appendChild(mediaPara);
        }

        // 2. Link/Title Line
        if (item.title || item.url) {
            const linkPara = document.createElement('p');
            linkPara.style.lineHeight = '1.5';

            // Use title or domain as label
            let label = item.title;
            if (!label && item.url) {
                try {
                    label = new URL(item.url).hostname;
                } catch {
                    label = 'View source';
                }
            }
            if (!label) label = 'View source';

            if (item.url) {
                const link = createStyledSourceLink(item.url, label);
                linkPara.appendChild(link);
            } else {
                linkPara.appendChild(createAiTextSpan(label));
            }

            fragment.appendChild(linkPara);
        }

        return fragment;
    }

    if (item.type === 'article') {
        const container = document.createElement('div'); // Keep article container for now or refactor? 
        // User asked for "image/video embeds". 
        // We'll return a fragment containing the div to match return type.

        container.className = resultCardClasses.item; // Keep existing style for articles
        container.dataset.resultType = item.type;
        if (item.url) container.dataset.url = item.url;

        container.appendChild(createAiTextBlock(item.snippet || item.title));
        if (item.url) {
            const articleLabel = item.title || 'Open article';
            const linkWrapper = document.createElement('div');
            linkWrapper.appendChild(document.createElement('br'));
            linkWrapper.appendChild(createStyledSourceLink(item.url, articleLabel));
            container.appendChild(linkWrapper);
        }
        fragment.appendChild(container); // Wrap in fragment
        return fragment;
    }

    return fragment;
};

const createSpacer = () => {
    const el = document.createElement('p');
    el.style.lineHeight = '1.5';
    el.style.minHeight = '1.5em';
    el.appendChild(document.createElement('br'));
    return el;
};

export const buildSearchResultsBlock = async (
    items: ResultItem[],
    notes?: SkeletonNotes
): Promise<DocumentFragment> => {
    const fragment = document.createDocumentFragment();

    // Fix: Reclassify articles that are actually videos/images
    const processedItems = items.map((item) => {
        if (item.type === 'article' && item.url) {
            const u = item.url.toLowerCase();
            if (u.includes('youtube.com') || u.includes('youtu.be') || u.includes('vimeo.com') || u.includes('dailymotion.com')) {
                return { ...item, type: 'video' as const };
            }
            if (/\.(jpg|jpeg|png|gif|webp)($|\?)/i.test(u)) {
                return { ...item, type: 'image' as const };
            }
        }
        return item;
    });

    // Helper to add safe text block
    const addTextBlock = (content: DocumentFragment | string) => {
        const p = document.createElement('p');
        p.style.lineHeight = '1.5';
        if (typeof content === 'string') {
            p.textContent = content;
        } else {
            p.appendChild(content);
        }
        fragment.appendChild(p);
    };

    const searchableItems = processedItems.filter((item) => item.type !== 'snippet');
    // STRICT FILTER: Only allow images that actually LOOK like images (url or thumbnail has extension).
    // This prevents "Wikipedia pages" from being rendered as broken images.
    const mediaItems = searchableItems.filter((item) => {
        // Common filter: Exclude obvious logos or icons
        const isLogo = (u: string) => /logo|icon|favicon/i.test(u);
        if ((item.url && isLogo(item.url)) || (item.thumbnail && isLogo(item.thumbnail))) return false;

        // Videos: Include if we have a URL (we can try to fetch thumb via proxy)
        if (item.type === 'video') return !!item.url;

        // Images: Include if we have a URL (we can fetch via proxy if it's a page)
        if (item.type === 'image') return !!item.url;

        return false;
    })
        .map((item) => {
            // Score each media item for quality and interestingness
            let score = 0;

            // Base score by type (videos often more engaging)
            if (item.type === 'video') score += 10;
            if (item.type === 'image') score += 5;

            // Quality indicators in URL or title
            const text = `${item.url || ''} ${item.title || ''}`.toLowerCase();

            // Positive signals (high-quality sources)
            if (/wikipedia|wikimedia|nasa|smithsonian|museum|archive|\.edu|\.gov/.test(text)) score += 15;
            if (/diagram|infographic|visualization|chart|graph|screenshot/.test(text)) score += 12;
            if (/hd|high.?res|4k|original|full.?size/.test(text)) score += 8;
            if (/official|documentation|research|scientific|academic/.test(text)) score += 10;

            // Negative signals (low-quality or generic)
            if (/stock|shutterstock|getty|istockphoto|dreamstime|pixabay|pexels/.test(text)) score -= 20;
            if (/thumbnail|preview|sample|watermark/.test(text)) score -= 10;
            if (/logo|icon|favicon|badge/.test(text)) score -= 15;
            if (/ad|advertisement|promo|marketing/.test(text)) score -= 12;
            if (/converter|download|tool|app|software/.test(text) && item.type === 'image') score -= 8;

            // Title length (more descriptive = better)
            if (item.title) {
                const titleLength = item.title.length;
                if (titleLength > 40 && titleLength < 120) score += 5;
                if (titleLength < 20) score -= 3;
            }

            // Has both thumbnail and URL (more complete data)
            if (item.thumbnail && item.url) score += 3;

            return { ...item, qualityScore: score };
        })
        .sort((a, b) => {
            // Sort by quality score (highest first)
            return (b.qualityScore || 0) - (a.qualityScore || 0);
        });
    const infoItems = searchableItems.filter((item) => item.type === 'article');

    const bestVideo = mediaItems.find(i => i.type === 'video');
    const bestImage = mediaItems.find(i => i.type === 'image');

    const limitedMedia = [];
    if (bestVideo) limitedMedia.push(bestVideo);
    if (bestImage) limitedMedia.push(bestImage);
    // const limitedInfo = infoItems.slice(0, 6); // we'll summarize these (unused var)

    const hasNotes = notes && notes.blocks.length > 0;
    if (limitedMedia.length === 0 && infoItems.length === 0 && !hasNotes) {
        const limitedInfo = infoItems.slice(0, 6);
        if (limitedMedia.length === 0 && limitedInfo.length === 0 && !hasNotes) {
            addTextBlock('No results found. Try a different search query.');
            return fragment;
        }
    }

    // 1. Sources Section (Viewed Sources) - TOP PRIORITY
    const sourceCount = infoItems.length;
    if (sourceCount > 0) {
        // Container for all sources
        const sourcesContainer = document.createElement('div');
        // sourcesContainer.className = 'mb-2'; // Removed CSS gap

        // Header
        const headerDiv = document.createElement('div');
        // headerDiv.className = 'flex items-center gap-1 mb-1'; // Removed CSS layouts
        headerDiv.style.lineHeight = '1.5';

        // Larger lined caret icon (SVG chevron)
        const caret = document.createElement('span');
        caret.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline; vertical-align: middle;"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
        caret.style.display = 'inline';
        caret.style.transition = 'transform 0.2s';
        caret.style.color = '#6e6e6e';
        caret.style.marginRight = '4px'; // Tiny text spacing

        const headerSpan = createAiTextSpan(`Viewed ${sourceCount} source${sourceCount === 1 ? '' : 's'}`);
        headerDiv.appendChild(caret);
        headerDiv.appendChild(headerSpan);

        // Sources list container (initially hidden)
        const listContainer = document.createElement('div');
        listContainer.style.display = 'none';
        // listContainer.style.paddingLeft = '4px'; // Removed CSS indent
        // listContainer.style.marginTop = '4px';

        // Toggle visibility on caret click
        let isOpen = false;
        caret.style.cursor = 'pointer';
        caret.contentEditable = 'false';
        caret.onclick = (e) => {
            e.stopPropagation();
            isOpen = !isOpen;
            listContainer.style.display = isOpen ? 'block' : 'none';
            caret.style.transform = isOpen ? 'rotate(90deg)' : 'rotate(0deg)';
        };

        // Each source using the unified component
        infoItems.forEach((item) => {
            if (item.url) {
                // Use title first as it's most descriptive, then source, then domain from URL
                let label = item.title || item.source;
                if (!label) {
                    try {
                        const url = new URL(item.url);
                        label = url.hostname.replace('www.', '');
                    } catch {
                        label = 'Source';
                    }
                }

                const sourceDiv = document.createElement('div');
                sourceDiv.style.lineHeight = '1.5';
                // sourceDiv.className = 'mb-0.5';
                sourceDiv.appendChild(createStyledSourceLink(item.url, label));
                listContainer.appendChild(sourceDiv);
            }
        });

        sourcesContainer.appendChild(headerDiv);
        sourcesContainer.appendChild(listContainer);

        fragment.appendChild(createSpacer()); // Added gap above sources
        fragment.appendChild(sourcesContainer);
        fragment.appendChild(createSpacer()); // Valid paragraph spacer
    }

    // 2. Media Section (Images/Videos)
    if (limitedMedia.length > 0) {
        limitedMedia.forEach((item) => {
            const card = createInlineResultCard(item);
            fragment.appendChild(card);
            fragment.appendChild(createSpacer());
        });
    }

    // 3. Excerpt Section (Quote)
    // Find the "best" excerpt from ARTICLES only
    const meaningfulSnippets = searchableItems.filter((i) => {
        if (i.type !== 'article') return false; // STRICT: Only articles
        if (!i.snippet) return false;
        const s = i.snippet.trim();
        const len = s.length;

        // STRICT: Filter out AI-generated summaries - must be direct source text
        // Reject snippets that start with summary phrases
        const aiSummaryPatterns = [
            /^(this|the|a|an) (video|article|page|paper|study|site|website|research|report|post|entry|piece|chapter|book|guide|tutorial|blog|review|analysis|document|source|resource|content|section|text|work|publication|journal)/i,
            /^video exploring/i,
            /^(this|it) (covers?|discusses?|explains?|describes?|explores?|examines?|analyzes?|reviews?|presents?|shows?|demonstrates?|provides?|offers?|outlines?|details?|focuses?)/i,
            /^(the author|authors?|researcher|researchers?|writer|study|research|article|paper) (cover|discuss|explain|describe|explore|examine|analyze|review|present|show|demonstrate|provide|offer|outline|detail|focus)/i,
            /^(here|in this|according to)/i,
            /^(an? )?(overview|summary|introduction|explanation|description|analysis) (of|to)/i
        ];

        for (const pattern of aiSummaryPatterns) {
            if (pattern.test(s)) return false;
        }

        return len >= 40 && len <= 400;
    });

    const sortedSnippets = meaningfulSnippets.sort((a, b) => {
        const aHasQuote = a.snippet!.includes('"') || a.snippet!.includes('“');
        const bHasQuote = b.snippet!.includes('"') || b.snippet!.includes('“');
        if (aHasQuote && !bHasQuote) return -1;
        if (!aHasQuote && bHasQuote) return 1;
        return b.snippet!.length - a.snippet!.length; // Longest first
    });

    const excerptItem = sortedSnippets[0];

    if (excerptItem) {
        // Render excerpt as plain italic text (no link parsing to avoid duplicates)
        const excerptText = `"${excerptItem.snippet || ''}"`;

        const excerptP = document.createElement('p');
        excerptP.style.lineHeight = '1.5';

        const excerptSpan = createAiTextSpan(excerptText);
        excerptSpan.style.fontStyle = 'italic';
        excerptP.appendChild(excerptSpan);

        fragment.appendChild(excerptP);

        // Single source link below the excerpt (the ONLY link)
        if (excerptItem.url) {
            const linkWrapper = document.createElement('p');
            linkWrapper.style.lineHeight = '1.5';
            linkWrapper.appendChild(createStyledSourceLink(
                excerptItem.url,
                excerptItem.title || 'Open source'
            ));
            fragment.appendChild(linkWrapper);
            fragment.appendChild(createSpacer());
        } else {
            fragment.appendChild(createSpacer());
        }
    }

    // 4. Information Section (AI Narrative)
    if (notes) {
        notes.blocks.forEach((block) => {
            if (block.kind === 'ai') {
                const aiP = document.createElement('p');
                aiP.style.lineHeight = '1.5';

                // Strict Sanitization
                const sanitizedText = block.text.replace(/\[([^\]]*)\]\(([^)]+)\)/g, '$1');
                aiP.appendChild(createAiTextWithLinksFragment(sanitizedText, '1.5'));
                fragment.appendChild(aiP);
                fragment.appendChild(createSpacer());
            }
        });

        // 5. Questions Section (Input Blocks) - LAST
        notes.blocks.forEach((block) => {
            if (block.kind === 'input') {
                // Flatten the input container - just output line by line

                // Question Prompt
                const promptP = document.createElement('p');
                promptP.style.lineHeight = '1.5';
                promptP.appendChild(createAiTextSpan(block.prompt));
                fragment.appendChild(promptP);

                // User lines - Always 2 gaps
                fragment.appendChild(createSpacer());
                fragment.appendChild(createSpacer());
            }
        });
    }

    return fragment;
};
