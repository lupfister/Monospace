import { resultCardClasses, type ResultItem } from './searchResultItems';
import { isImageUrl } from './linkPreviews';
import { createAiTextBlock } from './domUtils';
import { createAiTextWithLinksFragment, createAiTextSpan, createStyledSourceLink } from './textStyles';
import { formatAiOutputLabel } from './aiOutputLabel';
import { SkeletonNotes, SkeletonNoteBlock, AiError, exploreSource } from './openaiAgentApi';
import { ensureAiOutputId } from './aiOutputSources';
import { animateDisclosureHide, animateDisclosureShow } from './aiOutputVisibility';


/**
 * RENDERER RULES:
 * 1. ALWAYS work with the text editing document paradigm.
 * 2. Use paragraph margins for vertical rhythm; avoid inserting adaptive empty lines.
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
    container.dataset.aiText = 'true';
    container.dataset.aiOrigin = 'true';
    container.contentEditable = 'false';
    container.style.cssText = `
    display: block;
    user-select: none;
    pointer-events: none;
  `;

    // Add empty line gap above
    const spacer = document.createElement('div');
    spacer.style.height = '1.5em'; // Standard line height
    container.appendChild(spacer);

    // Phase message with shimmer effect
    const phaseText = document.createElement('div');
    phaseText.className = 'shimmer-phase-text';
    phaseText.textContent = PHASE_MESSAGES[phase];
    phaseText.style.cssText = `
    font-size: 13px;
    margin-bottom: 12px;
    font-style: italic;
    line-height: 1.5;
    background: linear-gradient(
      90deg,
      #6e6e6e 0%,
      #b0b0b0 50%,
      #6e6e6e 100%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: shimmer 2s infinite linear;
    width: fit-content;
  `;
    container.appendChild(phaseText);

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
    container.dataset.aiOrigin = 'true';
    container.style.cssText = `
    padding: 12px 16px;
    background: #fef2f2;
    border-left: 3px solid #ef4444;
    border-radius: 4px;
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

const createAiOutputSpacer = (): HTMLParagraphElement => {
    const spacer = document.createElement('p');
    spacer.dataset.aiOutputSpacer = 'true';
    spacer.style.lineHeight = '1.5';
    spacer.appendChild(document.createElement('br'));
    return spacer;
};

const createAiOutputToggle = (generatedAt?: string | null): HTMLParagraphElement => {
    const toggle = document.createElement('p');
    toggle.dataset.aiOutputToggle = 'true';
    toggle.dataset.aiUi = 'true';
    toggle.contentEditable = 'true';
    toggle.setAttribute('role', 'button');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.style.lineHeight = '1.5';
    toggle.style.display = 'inline-flex';
    toggle.style.alignItems = 'center';
    toggle.style.gap = '12px';
    toggle.style.cursor = 'pointer';
    toggle.style.userSelect = 'none';
    toggle.style.color = '#6e6e6e';
    toggle.style.fontFamily = 'Inter, sans-serif';
    toggle.style.fontSize = '14px';
    toggle.style.fontWeight = '350';
    toggle.style.fontVariationSettings = '"wght" 350';
    toggle.style.margin = '0';
    toggle.style.padding = '0';

    const icon = document.createElement('span');
    icon.dataset.aiOutputIcon = 'true';
    icon.dataset.aiUi = 'true';
    icon.contentEditable = 'false';
    icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: inline; vertical-align: middle;">
      <path data-ai-output-morph="true" d="M1 13C3 14.0044 6.8 13.6159 10 10C14 5.48013 11 2 8 2C5 2 2 5.48013 6 10C9.2 13.6159 13 14.0044 15 13" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"/>
      <path data-ai-output-loop-target="true" d="M1 13C3 14.0044 6.8 13.6159 10 10C14 5.48013 11 2 8 2C5 2 2 5.48013 6 10C9.2 13.6159 13 14.0044 15 13" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" opacity="0" pointer-events="none"/>
      <path data-ai-output-line-target="true" d="M1 8 L15 8" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" opacity="0" pointer-events="none"/>
    </svg>`;
    icon.style.display = 'inline';
    icon.style.transition = 'transform 0.2s';
    icon.style.color = '#6e6e6e';
    icon.style.transform = 'rotate(0deg)';
    icon.style.position = 'relative';
    icon.style.display = 'inline-flex';
    icon.style.alignItems = 'center';
    icon.style.justifyContent = 'center';
    const morphPath = icon.querySelector('[data-ai-output-morph="true"]') as SVGPathElement | null;
    const loopTarget = icon.querySelector('[data-ai-output-loop-target="true"]') as SVGPathElement | null;
    const lineTarget = icon.querySelector('[data-ai-output-line-target="true"]') as SVGPathElement | null;
    const ensureStrokeWidth = (path: SVGPathElement | null) => {
      if (!path) return;
      path.setAttribute('stroke-width', '1.5');
      path.style.strokeWidth = '1.5';
    };
    ensureStrokeWidth(morphPath);
    ensureStrokeWidth(loopTarget);
    ensureStrokeWidth(lineTarget);
    if (loopTarget) {
      loopTarget.style.opacity = '0';
    }
    if (lineTarget) {
      lineTarget.style.opacity = '1';
    }
    if (morphPath) {
      morphPath.style.opacity = '0';
    }
    icon.dataset.aiOutputState = 'line';

    const label = document.createElement('span');
    label.dataset.aiOutputLabel = 'true';
    label.dataset.aiUi = 'true';
    label.textContent = formatAiOutputLabel(false, generatedAt);
    label.contentEditable = 'false';

    const caret = document.createElement('span');
    caret.dataset.aiOutputCaret = 'true';
    caret.textContent = '\u200B';
    caret.contentEditable = 'true';
    caret.style.display = 'inline-block';
    caret.style.width = '0';
    caret.style.overflow = 'hidden';

    toggle.appendChild(icon);
    toggle.appendChild(label);
    toggle.appendChild(caret);

    return toggle;
};

const VIEWED_SOURCES_HEADER_ATTR = 'data-viewed-sources-header';
const VIEWED_SOURCES_CARET_ATTR = 'data-viewed-sources-caret';
const VIEWED_SOURCES_TEXT_REGEX = /^Viewed \d+ sources?/i;
const VIEWED_SOURCES_ICON_MORPH_ATTR = 'data-viewed-sources-morph';
const VIEWED_SOURCES_ICON_MAGNIFIER_ATTR = 'data-viewed-sources-magnifier';
const VIEWED_SOURCES_ICON_LINE_ATTR = 'data-viewed-sources-line';
const VIEWED_SOURCES_MORPH_SAMPLES = 36;
const VIEWED_SOURCES_ANIMATION_DURATION = 220;
type ViewedSourcesIconState = 'magnifier' | 'line';
const attachedViewedSourcesIcons = new WeakSet<HTMLElement>();
const attachedViewedSourcesHeaders = new WeakSet<HTMLElement>();

const samplePathPoints = (pathEl: SVGPathElement, samples: number) => {
    const total = pathEl.getTotalLength();
    const points = [];
    for (let i = 0; i < samples; i += 1) {
        const length = (total * i) / (samples - 1);
        points.push(pathEl.getPointAtLength(length));
    }
    return points;
};

const pointsToD = (points: { x: number; y: number }[]) => {
    if (!points.length) return '';
    const [first, ...rest] = points;
    const lines = rest.map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
    return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} ${lines.join(' ')}`;
};

const animateViewedSourcesMorph = (
    morphPath: SVGPathElement,
    fromPath: SVGPathElement,
    toPath: SVGPathElement,
    duration: number,
    onComplete?: () => void
) => {
    const startPoints = samplePathPoints(fromPath, VIEWED_SOURCES_MORPH_SAMPLES);
    const endPoints = samplePathPoints(toPath, VIEWED_SOURCES_MORPH_SAMPLES);
    const start = performance.now();
    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = easeInOut(t);
        const nextPoints = startPoints.map((point, index) => ({
            x: point.x + (endPoints[index].x - point.x) * eased,
            y: point.y + (endPoints[index].y - point.y) * eased,
        }));
        morphPath.setAttribute('d', pointsToD(nextPoints));
        morphPath.setAttribute('stroke-width', '1.5');
        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            morphPath.setAttribute('d', pointsToD(endPoints));
            morphPath.setAttribute('stroke-width', '1.5');
            if (onComplete) onComplete();
        }
    };
    morphPath.setAttribute('stroke-width', '1.5');
    morphPath.style.opacity = '1';
    requestAnimationFrame(step);
};
const setViewedSourcesIconState = (icon: HTMLElement, state: ViewedSourcesIconState) => {
    const magnifierPath = icon.querySelector<SVGPathElement>(`[${VIEWED_SOURCES_ICON_MAGNIFIER_ATTR}]`);
    const linePath = icon.querySelector<SVGPathElement>(`[${VIEWED_SOURCES_ICON_LINE_ATTR}]`);
    const morphPath = icon.querySelector<SVGPathElement>(`[${VIEWED_SOURCES_ICON_MORPH_ATTR}]`);
    if (!magnifierPath || !linePath) return;
    const showMagnifier = state === 'magnifier';
    magnifierPath.style.opacity = showMagnifier ? '1' : '0';
    linePath.style.opacity = showMagnifier ? '0' : '1';
    icon.dataset.viewedSourcesIconState = state;
    if (morphPath) morphPath.style.opacity = '0';
};

const transitionViewedSourcesIcon = (icon: HTMLElement, targetState: ViewedSourcesIconState) => {
    const morphPath = icon.querySelector<SVGPathElement>(`[${VIEWED_SOURCES_ICON_MORPH_ATTR}]`);
    const magnifierPath = icon.querySelector<SVGPathElement>(`[${VIEWED_SOURCES_ICON_MAGNIFIER_ATTR}]`);
    const linePath = icon.querySelector<SVGPathElement>(`[${VIEWED_SOURCES_ICON_LINE_ATTR}]`);
    if (!morphPath || !magnifierPath || !linePath) return;

    const currentState = (icon.dataset.viewedSourcesIconState as ViewedSourcesIconState) ?? 'magnifier';
    if (currentState === targetState) {
        setViewedSourcesIconState(icon, targetState);
        return;
    }

    const startPath = currentState === 'magnifier' ? magnifierPath : linePath;
    const endPath = targetState === 'magnifier' ? magnifierPath : linePath;
    morphPath.setAttribute('d', startPath.getAttribute('d') ?? '');
    magnifierPath.style.opacity = '0';
    linePath.style.opacity = '0';
    animateViewedSourcesMorph(morphPath, startPath, endPath, VIEWED_SOURCES_ANIMATION_DURATION, () => {
        setViewedSourcesIconState(icon, targetState);
    });
};

const MAGNIFIER_PATH_D = 'M14 14L9.68198 9.68198M11 6.5C11 8.98528 8.98528 11 6.5 11C4.01472 11 2 8.98528 2 6.5C2 4.01472 4.01472 2 6.5 2C8.98528 2 11 4.01472 11 6.5Z';
const LINE_PATH_D = 'M1 8h14';

const createViewedSourcesIcon = (): HTMLElement => {
    const icon = document.createElement('span');
    icon.dataset.viewedSourcesCaret = 'true';
    icon.dataset.viewedSourcesIconState = 'magnifier';
    icon.style.display = 'inline-flex';
    icon.style.alignItems = 'center';
    icon.style.justifyContent = 'center';
    icon.style.width = '16px';
    icon.style.height = '16px';
    icon.style.lineHeight = '1';
    icon.style.userSelect = 'none';
    icon.style.cursor = 'pointer';
    icon.style.color = '#6e6e6e';
    icon.style.position = 'relative';
    icon.style.transition = 'color 0.2s ease';
    icon.style.outline = 'none';
    icon.addEventListener('focus', () => {
        icon.style.outline = 'none';
    });
    icon.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block;">
            <path ${VIEWED_SOURCES_ICON_MORPH_ATTR} d="${MAGNIFIER_PATH_D}" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" opacity="0" pointer-events="none"/>
            <path ${VIEWED_SOURCES_ICON_MAGNIFIER_ATTR} d="${MAGNIFIER_PATH_D}" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" opacity="1"/>
            <path ${VIEWED_SOURCES_ICON_LINE_ATTR} d="${LINE_PATH_D}" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" opacity="0"/>
        </svg>
    `;
    icon.addEventListener('mousedown', (event) => {
        event.preventDefault();
    });
    return icon;
};

const getInitialViewedSourcesState = (list: HTMLElement, fallback?: boolean): boolean => {
    if (typeof fallback === 'boolean') {
        return fallback;
    }
    const datasetState = list.dataset.viewedSourcesOpen;
    if (datasetState === 'true') return true;
    if (datasetState === 'false') return false;
    const explicit = (list.style.display || '').trim();
    if (explicit && explicit !== 'none') return true;
    return false;
};

const attachViewedSourcesToggle = (
    icon: HTMLElement,
    list: HTMLElement,
    fallbackState?: boolean,
    headerOverride?: HTMLElement | null
) => {
    if (!icon || !list) return;

    const header = headerOverride
        || (icon.closest(`[${VIEWED_SOURCES_HEADER_ATTR}]`) as HTMLElement | null);
    if (header) {
        header.dataset.viewedSourcesHeader = 'true';
        header.style.cursor = 'pointer';
    }
    icon.dataset.viewedSourcesCaret = 'true';
    list.dataset.viewedSourcesList = 'true';

    let isOpen = getInitialViewedSourcesState(list, fallbackState);
    const updateState = (open: boolean, animate = true) => {
        isOpen = open;
        if (animate) {
            if (open) {
                animateDisclosureShow(list);
            } else {
                animateDisclosureHide(list);
            }
        } else {
            list.style.display = open ? 'block' : 'none';
        }
        list.dataset.viewedSourcesOpen = open ? 'true' : 'false';
        icon.dataset.viewedSourcesOpen = open ? 'true' : 'false';
        if (animate) {
            transitionViewedSourcesIcon(icon, open ? 'line' : 'magnifier');
        } else {
            setViewedSourcesIconState(icon, open ? 'line' : 'magnifier');
        }
    };

    if (!attachedViewedSourcesIcons.has(icon)) {
        icon.tabIndex = 0;
        icon.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                updateState(!isOpen);
            }
        });
        icon.addEventListener('click', (event) => {
            event.stopPropagation();
            updateState(!isOpen);
        });
        attachedViewedSourcesIcons.add(icon);
    }
    if (header && !attachedViewedSourcesHeaders.has(header)) {
        header.addEventListener('click', (event) => {
            event.stopPropagation();
            updateState(!isOpen);
        });
        attachedViewedSourcesHeaders.add(header);
    }
    updateState(isOpen, false);
};

const findCaretNode = (header: HTMLElement): HTMLElement | null => {
    const flagged = header.querySelector<HTMLElement>(`span[${VIEWED_SOURCES_CARET_ATTR}]`);
    if (flagged) {
        return flagged;
    }
    const spans = header.querySelectorAll('span');
    for (const span of spans) {
        if (span.querySelector('svg')) {
            return span;
        }
    }
    return null;
};

export const rehydrateViewedSourcesToggles = (root: HTMLElement | null) => {
    if (!root) return;
    const processed = new Set<HTMLElement>();

    const processHeader = (header: HTMLElement) => {
        if (processed.has(header)) return;
        const caret = findCaretNode(header);
        const list = header.nextElementSibling as HTMLElement | null;
        if (!caret || !list) return;
        attachViewedSourcesToggle(caret, list, undefined, header);
        processed.add(header);
    };

    const datasetHeaders = Array.from(root.querySelectorAll<HTMLElement>(`[${VIEWED_SOURCES_HEADER_ATTR}]`));
    datasetHeaders.forEach(processHeader);

    const fallbackHeaders = Array.from(root.querySelectorAll<HTMLElement>('div, p')).filter((header) => {
        if (processed.has(header)) return false;
        const text = (header.textContent || '').trim();
        if (!VIEWED_SOURCES_TEXT_REGEX.test(text)) return false;
        const list = header.nextElementSibling as HTMLElement | null;
        if (!list || list.tagName !== 'DIV') return false;
        if (!list.querySelector('a')) return false;
        return true;
    });
    fallbackHeaders.forEach(processHeader);
};

const attachedLearnMoreButtons = new WeakSet<HTMLElement>();

const attachLearnMoreHandlers = (
    learnMoreBtn: HTMLElement,
    summaryContainer: HTMLElement,
    url: string,
    initialContext: string = ''
) => {
    if (attachedLearnMoreButtons.has(learnMoreBtn)) return;

    learnMoreBtn.onmouseenter = () => {
        if (!learnMoreBtn.dataset.loading) learnMoreBtn.style.color = '#4b5563';
    };
    learnMoreBtn.onmouseleave = () => {
        if (!learnMoreBtn.dataset.loading) learnMoreBtn.style.color = '#9ca3af';
    };

    learnMoreBtn.onclick = async (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (learnMoreBtn.dataset.loading === 'true') return;

        learnMoreBtn.dataset.loading = 'true';
        learnMoreBtn.textContent = 'Learning...';
        learnMoreBtn.style.cursor = 'wait';

        summaryContainer.style.display = 'block';

        const prevError = summaryContainer.querySelector('.ai-error-inline');
        if (prevError) prevError.remove();

        const shimmer = createLoadingShimmer('searching');
        shimmer.style.margin = '0';
        shimmer.style.padding = '0 0 8px 0';
        summaryContainer.appendChild(shimmer);

        try {
            const currentSummary = summaryContainer.innerText.trim();
            const fullContext = [initialContext, currentSummary].filter(Boolean).join(' ');

            const result = await exploreSource(url, null, fullContext);

            const lastChild = summaryContainer.lastChild;
            if (lastChild && (lastChild as HTMLElement).className === 'ai-error-inline') {
                lastChild.remove();
            }
            if (shimmer && shimmer.parentNode) {
                shimmer.remove();
            }

            if (result.ok && result.text) {
                const p = document.createElement('p');

                const cleanText = result.text
                    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                    .replace(/https?:\/\/[^\s]+/g, '');

                summaryContainer.appendChild(createSpacer());
                p.appendChild(createAiTextSpan(cleanText));
                summaryContainer.appendChild(p);

                learnMoreBtn.dataset.loading = 'false';
                learnMoreBtn.textContent = 'Learn more';
                learnMoreBtn.style.cursor = 'pointer';
            } else {
                const errDiv = document.createElement('div');
                errDiv.className = 'ai-error-inline';
                errDiv.style.color = '#ef4444';
                errDiv.style.fontSize = '12px';
                errDiv.textContent = result.error || 'Could not load info.';
                summaryContainer.appendChild(errDiv);

                learnMoreBtn.textContent = 'Retry';
                learnMoreBtn.dataset.loading = 'false';
                learnMoreBtn.style.cursor = 'pointer';
            }
        } catch (err) {
            if (shimmer && shimmer.parentNode) {
                shimmer.remove();
            }
            const errDiv = document.createElement('div');
            errDiv.className = 'ai-error-inline';
            errDiv.style.color = '#ef4444';
            errDiv.style.fontSize = '12px';
            errDiv.textContent = 'Error loading info.';
            summaryContainer.appendChild(errDiv);

            learnMoreBtn.textContent = 'Retry';
            learnMoreBtn.dataset.loading = 'false';
            learnMoreBtn.style.cursor = 'pointer';
        }
    };

    attachedLearnMoreButtons.add(learnMoreBtn);
};

/**
 * Creates an interactive source item with a "Learn more" button integrated within the link.
 */
const createInteractiveSourceItem = (url: string, label: string, initialContext: string = ''): HTMLDivElement => {
    const container = document.createElement('div');
    container.dataset.sourceItem = 'true';
    container.dataset.sourceUrl = url;
    container.dataset.sourceContext = initialContext;
    container.style.margin = '0';
    // container.style.marginBottom = '8px'; // Removed spacer gap

    // Container for AI summary (inserted above link)
    const summaryContainer = document.createElement('div');
    summaryContainer.dataset.sourceSummary = 'true';
    summaryContainer.style.display = 'none';
    // summaryContainer.style.marginBottom = '6px'; // Removed spacer gap
    // Use standard AI text styling (Inter, gray)
    summaryContainer.style.fontFamily = 'Inter, sans-serif';
    summaryContainer.style.fontSize = '14px';
    summaryContainer.style.color = '#6e6e6e';
    summaryContainer.style.lineHeight = '1.5';
    container.appendChild(summaryContainer);

    // 1. Source Link (The wrapper)
    const linkComponent = createStyledSourceLink(url, label);

    // 2. Learn More Button (Appended INSIDE the link component)
    const learnMoreBtn = document.createElement('span');
    learnMoreBtn.textContent = 'Learn more';
    learnMoreBtn.style.fontSize = '11px'; // Slightly smaller
    learnMoreBtn.style.color = '#9ca3af'; // Gray text
    learnMoreBtn.style.cursor = 'pointer';
    learnMoreBtn.style.marginLeft = '8px';
    learnMoreBtn.style.paddingLeft = '8px';
    learnMoreBtn.style.borderLeft = '1px solid #e5e7eb';
    learnMoreBtn.style.whiteSpace = 'nowrap';
    learnMoreBtn.style.transition = 'color 0.2s';
    learnMoreBtn.dataset.sourceLearnMore = 'true';
    attachLearnMoreHandlers(learnMoreBtn, summaryContainer, url, initialContext);

    linkComponent.appendChild(learnMoreBtn);
    container.appendChild(linkComponent);

    return container;
};

export const rehydrateInteractiveSources = (root: HTMLElement | null): void => {
    if (!root) return;
    const containers = Array.from(root.querySelectorAll<HTMLElement>('[data-source-item="true"]'));
    containers.forEach((container) => {
        const url = container.dataset.sourceUrl;
        if (!url) return;
        const summary = container.querySelector<HTMLElement>('[data-source-summary="true"]');
        const learnMore = container.querySelector<HTMLElement>('[data-source-learn-more="true"]');
        if (!summary || !learnMore) return;
        const initialContext = container.dataset.sourceContext || '';
        attachLearnMoreHandlers(learnMore, summary, url, initialContext);
    });
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
            mediaWrapper.dataset.aiText = 'true';
            mediaWrapper.dataset.aiOrigin = 'true';
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
            linkPara.dataset.aiText = 'true';
            linkPara.dataset.aiOrigin = 'true';
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
        container.dataset.aiText = 'true';
        container.dataset.aiOrigin = 'true';
        if (item.url) container.dataset.url = item.url;

        container.appendChild(createAiTextBlock(item.snippet || item.title));
        if (item.url) {
            const articleLabel = item.title || 'Open article';
            const linkWrapper = document.createElement('div');
            linkWrapper.style.marginTop = '0';
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
    el.dataset.aiText = 'true';
    el.dataset.aiOrigin = 'true';
    el.dataset.aiOutputSpacer = 'true';
    el.style.lineHeight = '1.5';
    el.style.minHeight = '1.5em';
    el.appendChild(document.createElement('br'));
    return el;
};

const createParagraphSpace = () => {
    const el = document.createElement('p');
    el.dataset.aiText = 'true';
    el.dataset.aiOrigin = 'true';
    el.style.lineHeight = '1.5';
    el.appendChild(document.createElement('br'));
    return el;
};

const getHostnameSafe = (rawUrl?: string): string => {
    if (!rawUrl) return '';
    try {
        return new URL(rawUrl).hostname;
    } catch {
        return '';
    }
};

export const buildSearchResultsBlock = async (
    items: ResultItem[],
    notes?: SkeletonNotes
): Promise<HTMLElement> => {
    const outputContainer = document.createElement('div');
    outputContainer.dataset.aiOutput = 'true';
    outputContainer.dataset.aiOutputCollapsed = 'false';
    outputContainer.dataset.aiOutputGeneratedAt = new Date().toISOString();
    ensureAiOutputId(outputContainer);

    outputContainer.appendChild(createAiOutputSpacer());
    const toggle = createAiOutputToggle(outputContainer.dataset.aiOutputGeneratedAt);
    outputContainer.appendChild(toggle);
    outputContainer.appendChild(createAiOutputSpacer());

    const body = document.createElement('div');
    body.dataset.aiOutputBody = 'true';
    outputContainer.appendChild(body);

    const fragment = document.createDocumentFragment();

    // Fix: Reclassify articles that are actually videos/images (legacy check, mostly unused now as we only search web)
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
        p.dataset.aiText = 'true';
        p.dataset.aiOrigin = 'true';
        if (typeof content === 'string') {
            p.appendChild(createAiTextSpan(content));
        } else {
            p.appendChild(content);
        }
        fragment.appendChild(p);
    };

    const searchableItems = processedItems.filter((item) => item.type !== 'snippet');
    const infoItems = searchableItems.filter((item) => item.type === 'article');

    const hasNotes = notes && notes.blocks.length > 0;
    if (infoItems.length === 0 && !hasNotes) {
        addTextBlock('No results found. Try a different search query.');
        body.appendChild(fragment);
        return outputContainer;
    }

    // 1. Sources Section (Viewed Sources) - TOP PRIORITY
    const sourceCount = infoItems.length;
    if (sourceCount > 0) {
        // Container for all sources
        const sourcesContainer = document.createElement('div');
        sourcesContainer.dataset.aiText = 'true';
        sourcesContainer.dataset.aiOrigin = 'true';

        // Header
        const headerPara = document.createElement('p');
        headerPara.dataset.viewedSourcesHeader = 'true';
        headerPara.style.lineHeight = '1.5';
        headerPara.style.margin = '0';
        headerPara.style.display = 'inline-flex';
        headerPara.style.alignItems = 'center';
        headerPara.style.gap = '12px';

        const icon = createViewedSourcesIcon();
        const headerSpan = createAiTextSpan(`Viewed ${sourceCount} source${sourceCount === 1 ? '' : 's'}`);
        headerSpan.contentEditable = 'false';
        headerPara.appendChild(icon);
        headerPara.appendChild(headerSpan);

        // Sources list container (initially hidden)
        const listContainer = document.createElement('div');
        listContainer.style.display = 'none';
        attachViewedSourcesToggle(icon, listContainer, false, headerPara);

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
                sourceDiv.appendChild(createInteractiveSourceItem(
                    item.url,
                    label,
                    item.snippet || '' // Pass snippet as context
                ));
                listContainer.appendChild(sourceDiv);
            }
        });

        sourcesContainer.appendChild(headerPara);
        sourcesContainer.appendChild(listContainer);

        fragment.appendChild(sourcesContainer);
        fragment.appendChild(createSpacer());
    }

    // 2. Excerpt Section (Quotes)
    type ExcerptCandidate = ResultItem & {
        cleanedSnippet: string;
        domain: string;
        tokenSet: Set<string>;
        score: number;
    };

    const excerptSummaryPatterns = [
        /^(this|the|a|an)\s+(video|article|page|paper|study|site|website|research|report|post|entry|piece|chapter|book|guide|tutorial|blog|review|analysis|document|source|resource|content|section|text|work|publication|journal)\b/i,
        /^(this|it)\s+(covers?|discusses?|explains?|describes?|explores?|examines?|analyzes?|reviews?|presents?|shows?|demonstrates?|provides?|offers?|outlines?|details?|focuses?)\b/i,
        /^(the\s+author|authors?|researcher|researchers?|writer|study|research|article|paper)\s+(cover|discuss|explain|describe|explore|examine|analyze|review|present|show|demonstrate|provide|offer|outline|detail|focus)\b/i,
        /^(here|in this|according to)\b/i,
        /^(an?\s+)?(overview|summary|introduction|explanation|description|analysis)\s+(of|to)\b/i,
    ];

    const cleanSnippet = (text: string): string => {
        let cleaned = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        cleaned = cleaned.replace(/\s*\(?https?:\/\/[^\s)]+\)?\.?$/g, '');
        cleaned = cleaned.replace(/\s*\([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\)\.?$/g, '');
        cleaned = cleaned.replace(/\s*(?:Source|Via):.*$/i, '');
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        cleaned = cleaned.replace(/^["“”'`]+/, '').replace(/["“”'`]+$/, '');
        return cleaned.trim();
    };

    const excerptTokens = (text: string): Set<string> => {
        const tokens = text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((token) => token.length >= 4);
        return new Set(tokens);
    };

    const excerptSimilarity = (a: Set<string>, b: Set<string>): number => {
        if (a.size === 0 || b.size === 0) return 0;
        let overlap = 0;
        a.forEach((token) => {
            if (b.has(token)) overlap += 1;
        });
        const denominator = Math.max(a.size, b.size);
        return denominator ? overlap / denominator : 0;
    };

    const excerptScore = (snippet: string): number => {
        const len = snippet.length;
        const quoteBonus = /["“”]/.test(snippet) ? 18 : 0;
        const numericBonus = /\b\d{2,4}\b/.test(snippet) ? 10 : 0;
        const concreteBonus = /%|°|km|kg|ms|GHz|USD|\$/.test(snippet) ? 8 : 0;
        const sentenceBonus = /[.!?]/.test(snippet) ? 6 : 0;
        const idealLengthPenalty = Math.abs(160 - len) * 0.12;
        return quoteBonus + numericBonus + concreteBonus + sentenceBonus + Math.max(0, 28 - idealLengthPenalty);
    };

    const excerptCandidates: ExcerptCandidate[] = searchableItems
        .filter((item): item is ResultItem & { type: 'article'; snippet: string } => item.type === 'article' && typeof item.snippet === 'string')
        .map((item) => {
            const cleanedSnippet = cleanSnippet(item.snippet);
            return {
                ...item,
                cleanedSnippet,
                domain: getHostnameSafe(item.url),
                tokenSet: excerptTokens(cleanedSnippet),
                score: excerptScore(cleanedSnippet),
            };
        })
        .filter((item) => {
            const len = item.cleanedSnippet.length;
            if (len < 45 || len > 380) return false;
            if (excerptSummaryPatterns.some((pattern) => pattern.test(item.cleanedSnippet))) return false;
            return true;
        })
        .sort((a, b) => b.score - a.score);

    const topExcerpts: ExcerptCandidate[] = [];
    for (const candidate of excerptCandidates) {
        if (topExcerpts.length >= 3) break;
        if (topExcerpts.length === 0) {
            topExcerpts.push(candidate);
            continue;
        }

        const hasHighOverlap = topExcerpts.some((selected) => excerptSimilarity(candidate.tokenSet, selected.tokenSet) > 0.7);
        if (hasHighOverlap) continue;

        const firstScore = topExcerpts[0].score;
        const minScoreRatio = topExcerpts.length === 1 ? 0.68 : 0.78;
        const minLength = topExcerpts.length === 1 ? 70 : 90;
        const hasDistinctDomain = topExcerpts.every((selected) => !candidate.domain || !selected.domain || selected.domain !== candidate.domain);

        if (candidate.score < firstScore * minScoreRatio) continue;
        if (candidate.cleanedSnippet.length < minLength) continue;
        if (topExcerpts.length >= 2 && !hasDistinctDomain) continue;

        topExcerpts.push(candidate);
    }

    if (topExcerpts.length === 0) {
        const relaxedCandidates: ExcerptCandidate[] = searchableItems
            .filter((item): item is ResultItem & { type: 'article'; snippet: string } => item.type === 'article' && typeof item.snippet === 'string')
            .map((item) => {
                const cleanedSnippet = cleanSnippet(item.snippet);
                return {
                    ...item,
                    cleanedSnippet,
                    domain: getHostnameSafe(item.url),
                    tokenSet: excerptTokens(cleanedSnippet),
                    score: excerptScore(cleanedSnippet),
                };
            })
            .filter((item) => item.cleanedSnippet.length >= 25)
            .sort((a, b) => b.score - a.score);

        if (relaxedCandidates.length > 0) {
            topExcerpts.push(relaxedCandidates[0]);
        }
    }

    const excerptRenderItems: Array<{
        url?: string;
        title: string;
        excerptText: string;
        contextSnippet: string;
    }> = topExcerpts.map((item) => ({
        url: item.url,
        title: item.title || 'Open source',
        excerptText: item.cleanedSnippet,
        contextSnippet: item.cleanedSnippet,
    }));

    if (excerptRenderItems.length === 0 && infoItems.length > 0) {
        const fallback = infoItems[0];
        const fallbackText = (() => {
            if (typeof fallback.snippet === 'string' && fallback.snippet.trim()) {
                const cleaned = cleanSnippet(fallback.snippet);
                if (cleaned) return cleaned;
            }
            return `Source focus: ${fallback.title || getHostnameSafe(fallback.url) || 'Key reference'}`;
        })();
        excerptRenderItems.push({
            url: fallback.url,
            title: fallback.title || 'Open source',
            excerptText: fallbackText,
            contextSnippet: fallbackText,
        });
    }

    if (excerptRenderItems.length > 0) {
        excerptRenderItems.forEach((excerptItem) => {
            const excerptP = document.createElement('p');
            excerptP.dataset.aiText = 'true';
            excerptP.dataset.aiOrigin = 'true';
            excerptP.style.lineHeight = '1.5';
            excerptP.style.margin = '0';

            const excerptSpan = createAiTextSpan(excerptItem.excerptText);
            excerptSpan.style.fontStyle = 'italic';
            excerptP.appendChild(excerptSpan);

            fragment.appendChild(excerptP);

            if (excerptItem.url) {
                const linkWrapper = document.createElement('div');
                linkWrapper.dataset.aiText = 'true';
                linkWrapper.dataset.aiOrigin = 'true';
                linkWrapper.style.lineHeight = '1.5';
                linkWrapper.style.margin = '0';

                linkWrapper.appendChild(createInteractiveSourceItem(
                    excerptItem.url,
                    excerptItem.title,
                    excerptItem.contextSnippet
                ));

                fragment.appendChild(linkWrapper);
                fragment.appendChild(createSpacer());
            } else {
                fragment.appendChild(createSpacer());
            }
        });
    }

    // 3. Questions Section (Input Blocks) - LAST
    if (notes) {
        notes.blocks.forEach((block) => {
            // IGNORE 'ai' blocks (Information Section) as per new requirements
            // Only render input blocks (Questions)

            if (block.kind === 'input') {
                // Flatten the input container - just output line by line

                // Question Prompt
                const promptP = document.createElement('p');
                promptP.dataset.aiText = 'true';
                promptP.dataset.aiOrigin = 'true';
                promptP.style.lineHeight = '1.5';
                promptP.appendChild(createAiTextSpan(block.prompt));
                fragment.appendChild(promptP);

                const lineCount = 2;
                for (let i = 0; i < lineCount; i += 1) {
                    fragment.appendChild(createParagraphSpace());
                }
            }
        });
    }

    body.appendChild(fragment);
    return outputContainer;
};
