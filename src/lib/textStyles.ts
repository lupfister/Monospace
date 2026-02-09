/**
 * Fundamental text styling rules for the application:
 * - Gray sans serif 14pt Inter text = AI/system written
 * - Black serif 20pt Garamond text = human/user written
 */

export const AI_TEXT_STYLE = {
  color: '#6e6e6e', // gray
  fontFamily: 'Inter, sans-serif',
  fontSize: '14px',
  fontWeight: 350,
  fontVariationSettings: '"wght" 350',
} as const;

export const HUMAN_TEXT_STYLE = {
  color: '#000000', // black
  fontFamily: 'Garamond, serif',
  fontSize: '20px',
} as const;

/**
 * Creates a span element with AI/system text styling
 */
export const createAiTextSpan = (text: string, lineHeight?: string): HTMLSpanElement => {
  const span = document.createElement('span');
  span.style.color = AI_TEXT_STYLE.color;
  span.style.fontFamily = AI_TEXT_STYLE.fontFamily;
  span.style.fontSize = AI_TEXT_STYLE.fontSize;
  span.style.fontWeight = String(AI_TEXT_STYLE.fontWeight);
  span.style.fontVariationSettings = AI_TEXT_STYLE.fontVariationSettings;
  span.style.verticalAlign = 'baseline';
  span.style.display = 'inline';
  if (lineHeight) {
    span.style.lineHeight = lineHeight;
  }
  span.style.whiteSpace = 'pre-wrap';
  span.textContent = text;
  span.setAttribute('data-ai-text', 'true');
  return span;
};

/** Match markdown-style links [label](url). URL is non-greedy up to closing ). */
const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Creates a DocumentFragment with AI-styled text and unified styled source links for [label](url) patterns.
 */
export const createAiTextWithLinksFragment = (text: string, lineHeight?: string): DocumentFragment => {
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MARKDOWN_LINK.lastIndex = 0;
  while ((match = MARKDOWN_LINK.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) {
      const span = createAiTextSpan(before, lineHeight);
      fragment.appendChild(span);
    }
    const label = (match[1] || match[2]).trim();
    const url = match[2].trim();

    // Use the unified styled source link for the markdown link
    const linkComponent = createStyledSourceLink(url, label);
    fragment.appendChild(linkComponent);

    lastIndex = MARKDOWN_LINK.lastIndex;
  }
  if (lastIndex === 0) {
    fragment.appendChild(createAiTextSpan(text, lineHeight));
  } else {
    const after = text.slice(lastIndex);
    if (after) {
      fragment.appendChild(createAiTextSpan(after, lineHeight));
    }
  }
  return fragment;
};

/**
 * Creates a unified AI source/link component with a gray highlight,
 * a left-aligned 'open' arrow icon, and AI-styled text.
 */
export const createStyledSourceLink = (url: string, label: string): HTMLElement => {
  const wrapper = document.createElement('span');
  wrapper.style.display = 'inline-flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.backgroundColor = 'var(--color-gray-100, #f3f4f6)';
  wrapper.style.borderRadius = '4px';
  wrapper.style.padding = '0px 5px';
  wrapper.style.margin = '0';
  wrapper.style.transition = 'background-color 0.15s ease';
  wrapper.style.cursor = 'default';
  wrapper.style.lineHeight = '1.5';
  wrapper.style.verticalAlign = 'middle';
  // wrapper.style.height = '1.2em'; // Removed fixed height for natural flow
  wrapper.style.maxWidth = '480px'; // Prevent very long links from breaking layout, but allow more title visibility
  wrapper.style.overflow = 'hidden';
  wrapper.setAttribute('data-ai-text', 'true');

  // Hover effect
  wrapper.onmouseenter = () => { wrapper.style.backgroundColor = 'var(--color-gray-200, #e5e7eb)'; };
  wrapper.onmouseleave = () => { wrapper.style.backgroundColor = 'var(--color-gray-100, #f3f4f6)'; };

  // Icon (Left) - External Link
  const iconSpan = document.createElement('span');
  iconSpan.style.display = 'inline-flex';
  iconSpan.style.alignItems = 'center';
  iconSpan.style.justifyContent = 'center';
  iconSpan.style.marginRight = '6px';
  iconSpan.style.cursor = 'pointer';
  iconSpan.style.flexShrink = '0';
  iconSpan.contentEditable = 'false';

  // Inline style on SVG to counter global "svg { display: block }" in index.css
  iconSpan.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6e6e6e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display: inline; vertical-align: middle;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;

  const openLink = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  iconSpan.onclick = openLink;

  // Text - use exact AI text style
  const textSpan = document.createElement('span');
  textSpan.textContent = label;
  textSpan.style.color = '#6e6e6e';
  textSpan.style.fontFamily = 'Inter, sans-serif';
  textSpan.style.fontSize = AI_TEXT_STYLE.fontSize;
  textSpan.style.fontWeight = '350';
  textSpan.style.fontVariationSettings = '"wght" 350';
  textSpan.style.lineHeight = '1.5';
  textSpan.style.cursor = 'text';
  textSpan.style.whiteSpace = 'nowrap';
  textSpan.style.overflow = 'hidden';
  textSpan.style.textOverflow = 'ellipsis';
  textSpan.style.flex = '1';
  textSpan.style.minWidth = '0';

  wrapper.appendChild(iconSpan);
  wrapper.appendChild(textSpan);

  // Accessibility and keyboard support
  wrapper.setAttribute('role', 'link');
  wrapper.setAttribute('aria-label', `Open source: ${label}`);
  wrapper.tabIndex = 0;
  wrapper.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      openLink(e);
    }
  };

  return wrapper;
};


/**
 * Creates a span element with human/user text styling
 */
export const createHumanTextSpan = (text: string, lineHeight?: string): HTMLSpanElement => {
  const span = document.createElement('span');
  span.style.color = HUMAN_TEXT_STYLE.color;
  span.style.fontFamily = HUMAN_TEXT_STYLE.fontFamily;
  span.style.fontSize = HUMAN_TEXT_STYLE.fontSize;
  span.style.verticalAlign = 'baseline';
  span.style.display = 'inline';
  if (lineHeight) {
    span.style.lineHeight = lineHeight;
  }
  span.style.whiteSpace = 'pre-wrap';
  span.textContent = text;
  return span;
};

/**
 * Checks if a span element matches human text styling
 */
export const isHumanTextSpan = (element: HTMLElement): boolean => {
  const style = window.getComputedStyle(element);
  const isBlack = style.color === 'rgb(0, 0, 0)' || style.color === '#000000' || style.color === 'black';
  const isGaramond = style.fontFamily.includes('Garamond') || style.fontFamily.includes('garamond');
  const is20px = style.fontSize === '20px';
  return isBlack && isGaramond && is20px;
};

/**
 * Checks if a span element matches AI text styling
 */
export const isAiTextSpan = (element: HTMLElement): boolean => {
  const style = window.getComputedStyle(element);
  const isGray = style.color === 'rgb(110, 110, 110)' || style.color === '#6e6e6e';
  const isInter = style.fontFamily.includes('Inter') || style.fontFamily.includes('inter');
  const is14px = style.fontSize === '14px';
  return isGray && isInter && is14px;
};
