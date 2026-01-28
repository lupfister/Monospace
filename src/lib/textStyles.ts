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
