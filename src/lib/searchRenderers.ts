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
export type LoadingPhase = 'planning' | 'searching' | 'generating' | 'generating_code';

const PHASE_MESSAGES: Record<LoadingPhase, string> = {
    planning: 'Understanding your text...',
    searching: 'Exploring sources...',
    generating: 'Crafting response...',
    generating_code: 'Designing visual experience...'
};

/**
 * Creates a shimmer loading indicator that appears in the document during AI review.
 * Shows horizontal shimmering lines with a phase message.
 */
export const createLoadingShimmer = (phase: LoadingPhase = 'planning'): HTMLDivElement => {
    const container = document.createElement('div');
    container.className = 'ai-loading-shimmer';
    container.dataset.loadingPhase = phase;
    container.dataset.aiText = 'true';
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
    container.dataset.aiText = 'true';
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

// ----------------------------------------------------------------------------
// CREATIVE CODING / VISUAL EXPERIENCE RENDERERS
// ----------------------------------------------------------------------------

/**
 * Creates a placeholder element for the visual experience.
 * It uses the same shimmer style but with a specific ID we can target later.
 */
export const createVisualExperiencePlaceholder = (): HTMLElement => {
    // We create a container that looks like a shimmer but has a unique ID
    const id = `visual-exp-placeholder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Re-use the shimmer creation logic but customize slightly
    const container = createLoadingShimmer('generating_code');
    container.id = id;
    container.dataset.visualPlaceholder = 'true';

    // Add a bit more spacing since it's a major section
    container.style.marginTop = '24px';
    container.style.marginBottom = '24px';

    return container;
};

/**
 * Mounts the Visual Experience component into the placeholder.
 * This is called asynchronously after the code has been generated.
 */
import { mountVisualExperience } from '../components/VisualExperience';

export const renderVisualExperience = (container: HTMLElement, code: string) => {
    // Clear the container (remove shimmer)
    container.innerHTML = '';

    // Remove style that might conflict (width/height)
    container.removeAttribute('style');
    // Ensure it's still non-editable wrapper
    container.contentEditable = 'false';
    container.dataset.aiText = 'true';
    container.className = 'visual-experience-wrapper';

    // Mount the React component
    mountVisualExperience(container, code, 'AI Generated Visualization');
};

const createSpacer = () => {
    const el = document.createElement('p');
    el.dataset.aiText = 'true';
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

    const searchableItems = items.filter((item) => item.type !== 'snippet');
    const infoItems = searchableItems.filter((item) => item.type === 'article');

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

    const hasNotes = notes && notes.blocks.length > 0;
    if (infoItems.length === 0 && !hasNotes) {
        addTextBlock('No results found. Try a different search query.');
        return fragment;
    }

    // 1. Sources Section (Viewed Sources) - TOP PRIORITY
    const sourceCount = infoItems.length;
    if (sourceCount > 0) {
        // Container for all sources
        const sourcesContainer = document.createElement('div');
        sourcesContainer.dataset.aiText = 'true';
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

    // 2. Visual Experience Placeholder (Creative Code)
    // Always insert a placeholder if we have narrative/notes, as we will try to generate one.
    // If no narrative, we probably won't generate anything.
    if (hasNotes) {
        fragment.appendChild(createVisualExperiencePlaceholder());
        fragment.appendChild(createSpacer());
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
        excerptP.dataset.aiText = 'true';
        excerptP.style.lineHeight = '1.5';

        const excerptSpan = createAiTextSpan(excerptText);
        excerptSpan.style.fontStyle = 'italic';
        excerptP.appendChild(excerptSpan);

        fragment.appendChild(excerptP);

        // Single source link below the excerpt (the ONLY link)
        if (excerptItem.url) {
            const linkWrapper = document.createElement('p');
            linkWrapper.dataset.aiText = 'true';
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
                aiP.dataset.aiText = 'true';
                if (block.text.trim().match(/\?$/)) {
                    aiP.dataset.aiQuestion = 'true';
                }
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
                promptP.dataset.aiText = 'true';
                promptP.dataset.aiQuestion = 'true';
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
