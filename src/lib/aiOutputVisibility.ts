import { isAiTextSpan, isHumanTextSpan } from './textStyles';

const AI_HIDE_DURATION = 300; // ms

const removeAttributeFromAll = (root: HTMLElement, selector: string, attr: string) => {
  root.querySelectorAll(selector).forEach((el) => {
    (el as HTMLElement).removeAttribute(attr);
  });
};

export const clearAiHiddenState = (root: HTMLElement) => {
  removeAttributeFromAll(root, '[data-ai-hidden="true"]', 'data-ai-hidden');
  removeAttributeFromAll(root, '[data-ai-contains-highlight="true"]', 'data-ai-contains-highlight');
  removeAttributeFromAll(root, '[data-ai-show-highlight="true"]', 'data-ai-show-highlight');
  root.querySelectorAll('[data-ai-linebreak="true"]').forEach((linebreak) => linebreak.remove());
  root.querySelectorAll('[data-ai-highlight-clone="true"]').forEach((clone) => clone.remove());
};

export const applyAiHiddenState = (root: HTMLElement) => {
  clearAiHiddenState(root);

  const aiNodes = new Set<HTMLElement>();
  root
    .querySelectorAll('[data-ai-text="true"], [data-ai-question="true"], [data-ai-origin="true"], span[role="link"]')
    .forEach((el) => {
      if ((el as HTMLElement).closest('[data-ai-ui="true"]')) return;
      aiNodes.add(el as HTMLElement);
    });

  root.querySelectorAll('span').forEach((span) => {
    const el = span as HTMLElement;
    if (el.closest('[data-ai-ui="true"]')) return;
    if (isAiTextSpan(el)) {
      aiNodes.add(el);
    }
    if (isHumanTextSpan(el)) {
      el.setAttribute('data-human-text', 'true');
    }
  });

  aiNodes.forEach((el) => {
    if (el !== root) {
      el.setAttribute('data-ai-hidden', 'true');
    }
  });

  const wrapAiTextNodes = (container: HTMLElement) => {
    Array.from(container.childNodes).forEach((node) => {
      if (node.nodeType !== Node.TEXT_NODE) return;
      const text = node.textContent || '';
      if (!text.trim()) return;
      if ((node as Text).parentElement?.closest('[data-ai-highlighted="true"]')) return;
      const span = document.createElement('span');
      span.setAttribute('data-ai-text', 'true');
      span.setAttribute('data-ai-hidden', 'true');
      span.textContent = text;
      node.parentNode?.insertBefore(span, node);
      node.parentNode?.removeChild(node);
    });
  };

  root.querySelectorAll('[data-ai-origin="true"], [data-ai-text="true"], [data-ai-question="true"]').forEach((el) => {
    if ((el as HTMLElement).closest('[data-ai-ui="true"]')) return;
    wrapAiTextNodes(el as HTMLElement);
  });

  root.querySelectorAll('[data-ai-text="true"]:not([data-ai-highlighted="true"])').forEach((el) => {
    (el as HTMLElement).setAttribute('data-ai-hidden', 'true');
  });

  const highlightParents = new Set<HTMLElement>();
  root.querySelectorAll('[data-ai-highlighted="true"]').forEach((el) => {
    (el as HTMLElement).removeAttribute('data-ai-hidden');
    let node: HTMLElement | null = el as HTMLElement;
    while (node && node !== root) {
      if (node.getAttribute('data-ai-hidden') === 'true') {
        node.setAttribute('data-ai-contains-highlight', 'true');
      }
      node = node.parentElement;
    }
    const block = (el as HTMLElement).closest('[data-ai-origin="true"], [data-ai-text="true"], [data-ai-question="true"]') as HTMLElement | null;
    if (block) {
      highlightParents.add(block);
    }
  });

  const highlightSpans = Array.from(root.querySelectorAll('[data-ai-highlighted="true"]')) as HTMLElement[];
  highlightSpans.forEach((el) => {
    const block = el.closest('[data-ai-origin="true"], [data-ai-text="true"], [data-ai-question="true"]') as HTMLElement | null;
    if (block) highlightParents.add(block);
  });

  highlightParents.forEach((block) => {
    block.removeAttribute('data-ai-hidden');
    block.setAttribute('data-ai-show-highlight', 'true');
  });

  const visibleUnits = Array.from(root.querySelectorAll('[data-ai-highlighted="true"], [data-human-text="true"]')) as HTMLElement[];
  visibleUnits.forEach((el, index) => {
    if (index === visibleUnits.length - 1) return;
    const next = el.nextSibling as HTMLElement | null;
    if (next && next.nodeType === Node.ELEMENT_NODE && (next as HTMLElement).getAttribute('data-ai-linebreak') === 'true') {
      return;
    }
    const spacer = document.createElement('span');
    spacer.setAttribute('data-ai-linebreak', 'true');
    spacer.style.display = 'block';
    spacer.style.whiteSpace = 'pre-wrap';
    const computed = window.getComputedStyle(el);
    spacer.style.fontFamily = computed.fontFamily;
    spacer.style.fontSize = computed.fontSize;
    spacer.style.lineHeight = computed.lineHeight;
    spacer.textContent = '\n';
    el.parentNode?.insertBefore(spacer, el.nextSibling);
  });
};

/** Check whether an element (or its descendants) contains persistent content. */
const hasPersistentContent = (el: HTMLElement): boolean =>
  el.getAttribute('data-ai-highlighted') === 'true' ||
  el.getAttribute('data-human-text') === 'true' ||
  el.getAttribute('data-ai-ui') === 'true' ||
  el.getAttribute('data-ai-output-toggle') === 'true' ||
  el.querySelector('[data-ai-highlighted="true"], [data-human-text="true"], [data-ai-ui="true"], [data-ai-output-toggle="true"]') !== null;

/** Clean up per-element animation inline styles. */
const clearElementAnimationStyles = (el: HTMLElement) => {
  for (const prop of ['height', 'overflow', 'opacity', 'transition', 'will-change',
    'margin-top', 'margin-bottom', 'padding-top', 'padding-bottom', 'min-height']) {
    el.style.removeProperty(prop);
  }
};

/**
 * Animate hiding AI content by collapsing individual AI-only children
 * of the body. Persistent content (highlighted text, human text, toggle)
 * stays visible and smoothly slides into position as surrounding
 * AI elements shrink away.
 */
export const animateAiHide = (body: HTMLElement, onComplete?: () => void) => {
  const children = Array.from(body.children) as HTMLElement[];

  // Separate AI-only elements (will collapse) from persistent ones (stay)
  const toHide: HTMLElement[] = [];
  for (const child of children) {
    if (!hasPersistentContent(child)) {
      toHide.push(child);
    }
  }

  if (toHide.length === 0) {
    applyAiHiddenState(body);
    onComplete?.();
    return;
  }

  // Phase 1: lock current dimensions
  for (const el of toHide) {
    el.style.height = el.offsetHeight + 'px';
    el.style.overflow = 'hidden';
    el.style.opacity = '1';
    el.style.willChange = 'height, opacity';
  }

  // Force reflow
  void body.offsetHeight;

  // Phase 2: animate to collapsed
  const dur = AI_HIDE_DURATION;
  for (const el of toHide) {
    el.style.transition = [
      `height ${dur}ms cubic-bezier(0.4, 0, 0.2, 1)`,
      `opacity ${Math.round(dur * 0.6)}ms ease-out`,
      `margin-top ${dur}ms cubic-bezier(0.4, 0, 0.2, 1)`,
      `margin-bottom ${dur}ms cubic-bezier(0.4, 0, 0.2, 1)`,
      `padding-top ${dur}ms cubic-bezier(0.4, 0, 0.2, 1)`,
      `padding-bottom ${dur}ms cubic-bezier(0.4, 0, 0.2, 1)`,
    ].join(', ');
    el.style.height = '0px';
    el.style.opacity = '0';
    el.style.marginTop = '0px';
    el.style.marginBottom = '0px';
    el.style.paddingTop = '0px';
    el.style.paddingBottom = '0px';
    el.style.minHeight = '0px';
  }

  // Phase 3: cleanup after animation completes
  setTimeout(() => {
    for (const el of toHide) {
      clearElementAnimationStyles(el);
    }
    applyAiHiddenState(body);
    onComplete?.();
  }, dur + 20);
};

/**
 * Animate showing AI content by expanding individual AI elements.
 * Assumes clearAiHiddenState has already been called on the body
 * so that content is in the DOM and measurable.
 */
export const animateAiShow = (body: HTMLElement, onComplete?: () => void) => {
  // Ensure the body container is visible
  body.style.removeProperty('display');

  const children = Array.from(body.children) as HTMLElement[];

  // Find AI content children to animate in
  const toShow: HTMLElement[] = [];
  for (const child of children) {
    if (child.getAttribute('data-ai-ui') === 'true') continue;
    if (child.getAttribute('data-ai-output-toggle') === 'true') continue;
    const isAi =
      child.getAttribute('data-ai-text') === 'true' ||
      child.getAttribute('data-ai-origin') === 'true' ||
      child.getAttribute('data-ai-question') === 'true';
    if (isAi) toShow.push(child);
  }

  if (toShow.length === 0) {
    onComplete?.();
    return;
  }

  // Measure natural heights
  const heights = new Map<HTMLElement, number>();
  for (const el of toShow) {
    heights.set(el, el.offsetHeight);
  }

  // Set starting state: collapsed
  for (const el of toShow) {
    el.style.height = '0px';
    el.style.overflow = 'hidden';
    el.style.opacity = '0';
    el.style.willChange = 'height, opacity';
    el.style.minHeight = '0px';
  }

  // Force reflow
  void body.offsetHeight;

  // Animate expansion
  const dur = AI_HIDE_DURATION;
  for (const el of toShow) {
    el.style.transition = [
      `height ${dur}ms cubic-bezier(0.4, 0, 0.2, 1)`,
      `opacity ${Math.round(dur * 0.7)}ms ease-in ${Math.round(dur * 0.15)}ms`,
    ].join(', ');
    el.style.height = (heights.get(el) ?? 0) + 'px';
    el.style.opacity = '1';
  }

  setTimeout(() => {
    for (const el of toShow) {
      clearElementAnimationStyles(el);
    }
    onComplete?.();
  }, dur + 20);
};
