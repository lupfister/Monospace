import { resultCardClasses, type ResultItem } from './searchResultItems';
import { isImageUrl } from './linkPreviews';
import { createAiTextBlock } from './domUtils';
import { createAiTextWithLinksFragment, createAiTextSpan, createStyledSourceLink } from './textStyles';
import type { SkeletonNotes, SkeletonNoteBlock } from './openaiAgentApi';


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
            img.style.minHeight = '120px';
            img.style.backgroundColor = 'var(--color-gray-100, #f3f4f6)';
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';

            // On error, try proxy if we haven't already, otherwise hide.
            img.onerror = () => {
                // If we already tried proxy (checked by src url), or if direct load failed
                // We could try to switch to proxy if direct failed?
                // For now, let's keep the removal behavior but maybe log it?
                // Actually, let's try to fallback to proxy if direct fails!
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

            container.appendChild(img);
        }
        return container;
    }

    if (item.type === 'article') {
        container.appendChild(createAiTextBlock(item.snippet || item.title));
        if (item.url) {
            const articleLabel = item.title ? `Open article: ${item.title}` : 'Open article';
            const linkWrapper = document.createElement('div');
            linkWrapper.className = 'mt-2';
            linkWrapper.appendChild(createStyledSourceLink(item.url, articleLabel));
            container.appendChild(linkWrapper);
        }
    }

    return container;
};

export const buildSearchResultsBlock = async (
    items: ResultItem[],
    notes?: SkeletonNotes
): Promise<HTMLElement> => {
    const resultsContainer = document.createElement('div');
    resultsContainer.className = resultCardClasses.block;
    resultsContainer.dataset.embed = 'search-results';
    resultsContainer.contentEditable = 'true'; // Allow text editing inside the results block
    const searchableItems = items.filter((item) => item.type !== 'snippet');
    // STRICT FILTER: Only allow images that actually LOOK like images (url or thumbnail has extension).
    // This prevents "Wikipedia pages" from being rendered as broken images.
    const mediaItems = searchableItems.filter((item) => {
        // Common filter: Exclude obvious logos or icons
        const isLogo = (u: string) => /logo|icon|favicon/i.test(u);

        // Videos: Include if thumbnail exists (YouTube auto-generated)
        if (item.type === 'video') return !!item.thumbnail;

        // Images: Must have valid image URL in thumbnail or url
        if (item.type === 'image') {
            return (item.thumbnail && isImageUrl(item.thumbnail)) || (item.url && isImageUrl(item.url));
        }

        return false;
    })
        .sort((a, b) => {
            // Prioritize Real Images/Videos over Articles
            const score = (type: string) => (type === 'article' ? 0 : 1);
            return score(b.type) - score(a.type);
        });
    const infoItems = searchableItems.filter((item) => item.type === 'article');

    const limitedMedia = mediaItems.slice(0, 1); // keep visuals minimal
    // const limitedInfo = infoItems.slice(0, 6); // we'll summarize these (unused var)

    const hasNotes = notes && notes.blocks.length > 0;
    if (limitedMedia.length === 0 && infoItems.length === 0 && !hasNotes) {
        const limitedInfo = infoItems.slice(0, 6);
        if (limitedMedia.length === 0 && limitedInfo.length === 0 && !hasNotes) {
            resultsContainer.appendChild(createAiTextBlock('No results found. Try a different search query.'));
            return resultsContainer;
        }
    }

    // 1. Sources Section (Viewed Sources) - TOP PRIORITY
    const sourceCount = infoItems.length;
    if (sourceCount > 0) {
        // Container for all sources
        const sourcesContainer = document.createElement('div');
        sourcesContainer.className = 'mb-2';

        // Clickable header with caret
        const headerDiv = document.createElement('div');
        headerDiv.className = 'flex items-center gap-1 mb-1';

        // Larger lined caret icon (SVG chevron)
        const caret = document.createElement('span');
        caret.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline;"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
        caret.style.display = 'inline-flex';
        caret.style.alignItems = 'center';
        caret.style.transition = 'transform 0.2s';
        caret.style.color = '#6e6e6e';

        const headerSpan = createAiTextSpan(`Viewed ${sourceCount} source${sourceCount === 1 ? '' : 's'}`);
        headerDiv.appendChild(caret);
        headerDiv.appendChild(headerSpan);

        // Sources list container (initially hidden)
        const listContainer = document.createElement('div');
        listContainer.style.display = 'none';
        listContainer.style.paddingLeft = '4px';
        listContainer.style.marginTop = '4px';

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
                sourceDiv.className = 'mb-0.5';
                sourceDiv.appendChild(createStyledSourceLink(item.url, label));
                listContainer.appendChild(sourceDiv);
            }
        });

        sourcesContainer.appendChild(headerDiv);
        sourcesContainer.appendChild(listContainer);
        resultsContainer.appendChild(sourcesContainer);
    }

    // 2. Media Section (Images/Videos)
    if (limitedMedia.length > 0) {
        limitedMedia.forEach((item) => {
            const card = createInlineResultCard(item);
            card.style.marginBottom = '12px'; // Add some spacing after media
            resultsContainer.appendChild(card);
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
        if (/^(this|the) (video|article|page|paper|study|site|website)/i.test(s)) return false;
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
        const block = document.createElement('blockquote');
        // Use AI text styling with italic for the excerpt
        block.style.borderLeft = '2px solid #e5e7eb';
        block.style.paddingLeft = '8px';
        block.style.margin = '8px 0';
        block.style.marginBottom = '16px'; // Spacing after excerpt

        // Parse markdown links in the excerpt and render them as clickable links
        const excerptText = `"${excerptItem.snippet || ''}"`;
        const excerptFragment = createAiTextWithLinksFragment(excerptText);
        // Apply italic styling to all text spans in the fragment
        excerptFragment.querySelectorAll('span').forEach((span) => {
            (span as HTMLSpanElement).style.fontStyle = 'italic';
        });
        block.appendChild(excerptFragment);
        resultsContainer.appendChild(block);

        // Restore the source link (always useful, especially if excerpt has no links)
        if (excerptItem.url) {
            const linkWrapper = document.createElement('div');
            linkWrapper.className = 'mb-2';
            linkWrapper.appendChild(createStyledSourceLink(
                excerptItem.url,
                excerptItem.title ? `Open source: ${excerptItem.title}` : 'Open source'
            ));
            resultsContainer.appendChild(linkWrapper);
        }
    }

    // 4. Information Section (AI Narrative)
    if (notes) {
        notes.blocks.forEach((block) => {
            if (block.kind === 'ai') {
                const aiBlock = document.createElement('div');
                aiBlock.className = 'mb-4';
                // Using createAiTextWithLinksFragment to support article links in the info section
                aiBlock.appendChild(createAiTextWithLinksFragment(block.text));
                resultsContainer.appendChild(aiBlock);
            }
        });

        // 5. Questions Section (Input Blocks) - LAST
        notes.blocks.forEach((block) => {
            if (block.kind === 'input') {
                const inputContainer = document.createElement('div');
                inputContainer.className = 'my-6';

                // Question Prompt
                const prompt = createAiTextBlock(block.prompt);
                prompt.style.marginBottom = '8px';
                inputContainer.appendChild(prompt);

                // User lines - clean paragraph gaps
                for (let i = 0; i < block.lines; i++) {
                    const line = document.createElement('p');
                    line.style.minHeight = '1em'; // Ensure clickable/visible height
                    line.style.margin = '8px 0';  // Nice spacing
                    line.appendChild(document.createElement('br'));
                    inputContainer.appendChild(line);
                }
                resultsContainer.appendChild(inputContainer);
            }
        });
    }

    return resultsContainer;
};
