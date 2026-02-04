import { resultCardClasses, type ResultItem } from './searchResultItems';
import { isImageUrl } from './linkPreviews';
import { createAiTextBlock } from './domUtils';
import { createAiTextWithLinksFragment, createAiTextSpan, createStyledSourceLink } from './textStyles';
import type { SkeletonNotes, SkeletonNoteBlock } from './openaiAgentApi';


/**
 * RENDERER RULES:
 * 1. ALWAYS work with the text editing document paradigm.
 * 2. Avoid CSS-based gaps (margins/padding) for vertical rhythm. Use text flow, <br>, or empty lines.
 * 3. Maintain a consistent line-height of 1.5.
 * 4. Content should allow for natural cursor movement and text selection.
 */


export const createInlineResultCard = (item: ResultItem): HTMLDivElement => {
    const isMedia = item.type === 'video' || item.type === 'image';
    const container = document.createElement('div');

    container.className = resultCardClasses.item;
    container.dataset.resultType = item.type;
    if (item.url) container.dataset.url = item.url;
    if (isMedia) container.contentEditable = 'false';

    if (item.type === 'image' || item.type === 'video') {
        const imageUrl = item.thumbnail || item.url || '';
        if (imageUrl) {
            // Create wrapper for better layout control
            const mediaWrapper = document.createElement('div');
            mediaWrapper.style.position = 'relative';
            mediaWrapper.style.overflow = 'hidden';
            mediaWrapper.style.borderRadius = '8px';

            const img = document.createElement('img');
            if (isImageUrl(imageUrl)) {
                img.src = imageUrl;
            } else {
                const proxyUrl = `/api/ai/image?url=${encodeURIComponent(imageUrl)}`;
                img.src = proxyUrl;
            }
            if (item.url) img.dataset.fallbackUrl = item.url;
            img.alt = item.title || (item.type === 'video' ? 'Video thumbnail' : 'Image');
            img.className = resultCardClasses.image;
            img.style.minHeight = '200px';
            img.style.maxHeight = '400px';
            img.style.width = '100%';
            img.style.objectFit = 'cover';
            img.style.backgroundColor = 'var(--color-gray-100, #f3f4f6)';
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';

            // On error, try proxy if we haven't already, otherwise hide.
            img.onerror = () => {
                const currentSrc = img.src;
                if (!currentSrc.includes('/api/ai/image')) {
                    img.src = `/api/ai/image?url=${encodeURIComponent(imageUrl)}`;
                    return;
                }

                if (container.parentNode) {
                    container.parentNode.removeChild(container);
                } else {
                    container.style.display = 'none';
                }
            };

            mediaWrapper.appendChild(img);

            // Add video play icon overlay for videos
            if (item.type === 'video') {
                const playIcon = document.createElement('div');
                playIcon.innerHTML = `<svg width="64" height="64" viewBox="0 0 24 24" fill="white" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
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
            }

            container.appendChild(mediaWrapper);

            // Add title/caption below media
            if (item.title) {
                const caption = document.createElement('div');
                // caption.style.marginTop = '8px'; // Removed CSS gap
                caption.appendChild(document.createElement('br')); // Use break for separation
                caption.style.fontSize = '13px';
                caption.style.lineHeight = '1.5';
                caption.style.color = '#374151';
                caption.style.fontWeight = '500';
                caption.textContent = item.title;
                container.appendChild(caption);
            }

            // Make the whole card clickable for videos
            if (item.type === 'video' && item.url) {
                container.style.cursor = 'pointer';
                container.style.transition = 'transform 0.2s, box-shadow 0.2s';
                container.onclick = () => {
                    window.open(item.url, '_blank', 'noopener,noreferrer');
                };
                container.onmouseenter = () => {
                    container.style.transform = 'translateY(-2px)';
                    container.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                };
                container.onmouseleave = () => {
                    container.style.transform = 'translateY(0)';
                    container.style.boxShadow = '';
                };
            }

            // For images, add a subtle link if URL exists
            if (item.type === 'image' && item.url) {
                const linkWrapper = document.createElement('div');
                // linkWrapper.style.marginTop = '6px'; // Removed CSS gap
                linkWrapper.appendChild(document.createElement('br'));
                const sourceLink = createStyledSourceLink(item.url, 'View source');
                linkWrapper.appendChild(sourceLink);
                container.appendChild(linkWrapper);
            }
        }
        return container;
    }

    if (item.type === 'article') {
        container.appendChild(createAiTextBlock(item.snippet || item.title));
        if (item.url) {
            const articleLabel = item.title || 'Open article';
            const linkWrapper = document.createElement('div');
            // linkWrapper.className = 'mt-2'; // Removed CSS gap
            linkWrapper.appendChild(document.createElement('br'));
            linkWrapper.appendChild(createStyledSourceLink(item.url, articleLabel));
            container.appendChild(linkWrapper);
        }
    }

    return container;
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

        // Filter out obvious meta-descriptions/summaries
        if (/^(this|the) (video|article|page|paper|study|site|website|research|report|post|entry)/i.test(s)) return false;
        if (/^video exploring/i.test(s)) return false;

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
        const block = document.createElement('div');
        // Standardize as a block
        block.style.display = 'block';

        const excerptText = `"${excerptItem.snippet || ''}"`;
        const excerptFragment = createAiTextWithLinksFragment(excerptText, '1.5');

        excerptFragment.querySelectorAll('span').forEach((span) => {
            (span as HTMLSpanElement).style.fontStyle = 'italic';
            (span as HTMLSpanElement).style.lineHeight = '1.5';
        });

        // Wrap in p for consistent spacing behavior if it looks like text
        const p = document.createElement('p');
        p.style.lineHeight = '1.5';
        p.appendChild(excerptFragment);

        fragment.appendChild(p);

        // Restore the source link (always useful, especially if excerpt has no links)
        if (excerptItem.url) {
            const linkWrapper = document.createElement('p'); // Use p for validation
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
