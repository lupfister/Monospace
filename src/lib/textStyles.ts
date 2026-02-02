/**
 * Fundamental text styling rules for the application:
 * - Gray sans serif 18pt Inter text = AI/system written
 * - Black serif 20pt Garamond text = human/user written
 */

export const AI_TEXT_STYLE = {
  color: '#6e6e6e', // gray
  fontFamily: 'Inter, sans-serif',
  fontSize: '18px',
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
  span.textContent = text;
  return span;
};

/** Match markdown-style links [label](url). URL is non-greedy up to closing ). */
const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Creates a DocumentFragment with AI-styled text and clickable links for [label](url) patterns.
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
    const label = match[1] || match[2];
    const url = match[2].trim();
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label;
    a.style.color = AI_TEXT_STYLE.color;
    a.style.fontFamily = AI_TEXT_STYLE.fontFamily;
    a.style.fontSize = AI_TEXT_STYLE.fontSize;
    a.style.fontWeight = String(AI_TEXT_STYLE.fontWeight);
    a.style.textDecoration = 'underline';
    a.style.cursor = 'pointer';
    fragment.appendChild(a);
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
  const is18px = style.fontSize === '18px';
  return isGray && isInter && is18px;
};
