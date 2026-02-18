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
      if ((el as HTMLElement).closest('[data-ai-output-toggle="true"]')) return;
      aiNodes.add(el as HTMLElement);
    });

  root.querySelectorAll('span').forEach((span) => {
    const el = span as HTMLElement;
    if (el.closest('[data-ai-ui="true"]')) return;
    if (el.closest('[data-ai-output-toggle="true"]')) return;
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
      if ((node as Text).parentElement?.closest('[data-ai-output-toggle="true"]')) return;
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
  const findHighlightBlock = (el: HTMLElement): HTMLElement | null => {
    let node: HTMLElement | null = el;
    while (node && node !== root) {
      if (node.getAttribute('data-ai-highlighted') === 'true') {
        node = node.parentElement;
        continue;
      }
      if (
        node.getAttribute('data-ai-origin') === 'true' ||
        node.getAttribute('data-ai-text') === 'true' ||
        node.getAttribute('data-ai-question') === 'true'
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  };
  root.querySelectorAll('[data-ai-highlighted="true"]').forEach((el) => {
    (el as HTMLElement).removeAttribute('data-ai-hidden');
    let node: HTMLElement | null = el as HTMLElement;
    while (node && node !== root) {
      if (node.getAttribute('data-ai-hidden') === 'true') {
        node.setAttribute('data-ai-contains-highlight', 'true');
      }
      node = node.parentElement;
    }
    const block = findHighlightBlock(el as HTMLElement);
    if (block) {
      highlightParents.add(block);
    }
  });

  const highlightSpans = Array.from(root.querySelectorAll('[data-ai-highlighted="true"]')) as HTMLElement[];
  highlightSpans.forEach((el) => {
    const block = findHighlightBlock(el);
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

/** Properties we add to elements during animation. */
const ANIM_PROPS = [
  'height', 'overflow', 'opacity', 'filter', 'transition',
  'will-change', 'margin-top', 'margin-bottom',
  'padding-top', 'padding-bottom', 'min-height',
] as const;

/** Clean up inline animation styles from an element. */
const clearAnimStyles = (el: HTMLElement) => {
  for (const prop of ANIM_PROPS) el.style.removeProperty(prop);
};

/**
 * Animate hiding AI content.
 *
 * Two coordinated layers run simultaneously:
 *   1. **Body height** transitions from full → target (height with AI
 *      elements removed). This gives external content a single, smooth
 *      upward slide with no per-element jittering.
 *   2. **Per-element fade + blur** on each AI-only child makes the
 *      content itself disappear visually inside the clipped body.
 *
 * Persistent content (highlighted text, human text, toggle) is untouched.
 */
export const animateAiHide = (body: HTMLElement, onComplete?: () => void) => {
  const children = Array.from(body.children) as HTMLElement[];

  const toHide: HTMLElement[] = [];
  for (const child of children) {
    if (!hasPersistentContent(child)) toHide.push(child);
  }

  if (toHide.length === 0) {
    applyAiHiddenState(body);
    onComplete?.();
    return;
  }

  // ── Measure ──────────────────────────────────────────────────────
  const startHeight = body.offsetHeight;

  // Temporarily collapse AI elements to measure target body height
  for (const el of toHide) el.style.display = 'none';
  void body.offsetHeight;                       // force reflow
  const targetHeight = body.offsetHeight;
  for (const el of toHide) el.style.removeProperty('display');

  // ── Lock starting state ──────────────────────────────────────────
  // Body container — controls external layout
  body.style.height = startHeight + 'px';
  body.style.overflow = 'hidden';
  body.style.willChange = 'height';

  // Individual AI elements — controls visual disappearance
  for (const el of toHide) {
    el.style.opacity = '1';
    el.style.filter = 'blur(0px)';
    el.style.willChange = 'opacity, filter';
  }

  void body.offsetHeight;                       // commit starting values

  // ── Animate ──────────────────────────────────────────────────────
  const dur = AI_HIDE_DURATION;
  const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';

  body.style.transition = `height ${dur}ms ${ease}`;
  body.style.height = targetHeight + 'px';

  for (const el of toHide) {
    el.style.transition = [
      `opacity ${Math.round(dur * 0.55)}ms ease-out`,
      `filter ${dur}ms ease-out`,
    ].join(', ');
    el.style.opacity = '0';
    el.style.filter = 'blur(4px)';
  }

  // ── Cleanup ──────────────────────────────────────────────────────
  setTimeout(() => {
    clearAnimStyles(body);
    for (const el of toHide) clearAnimStyles(el);
    applyAiHiddenState(body);
    onComplete?.();
  }, dur + 20);
};

/**
 * Animate showing AI content (reverse of hide).
 *
 * Same dual-layer approach: body height expands smoothly while
 * individual AI elements de-blur and fade in.
 * Assumes clearAiHiddenState has already been called.
 */
export const animateAiShow = (body: HTMLElement, onComplete?: () => void) => {
  body.style.removeProperty('display');

  const children = Array.from(body.children) as HTMLElement[];

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

  // ── Measure ──────────────────────────────────────────────────────
  const targetHeight = body.offsetHeight;       // full height with AI visible

  // Calculate starting height (without AI elements)
  for (const el of toShow) el.style.display = 'none';
  void body.offsetHeight;
  const startHeight = body.offsetHeight;
  for (const el of toShow) el.style.removeProperty('display');

  // Measure each element's natural height
  const heights = new Map<HTMLElement, number>();
  for (const el of toShow) heights.set(el, el.offsetHeight);

  // ── Lock starting state ──────────────────────────────────────────
  body.style.height = startHeight + 'px';
  body.style.overflow = 'hidden';
  body.style.willChange = 'height';

  for (const el of toShow) {
    el.style.height = '0px';
    el.style.overflow = 'hidden';
    el.style.opacity = '0';
    el.style.filter = 'blur(4px)';
    el.style.willChange = 'height, opacity, filter';
    el.style.minHeight = '0px';
  }

  void body.offsetHeight;                       // commit starting values

  // ── Animate ──────────────────────────────────────────────────────
  const dur = AI_HIDE_DURATION;
  const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';

  body.style.transition = `height ${dur}ms ${ease}`;
  body.style.height = targetHeight + 'px';

  for (const el of toShow) {
    el.style.transition = [
      `height ${dur}ms ${ease}`,
      `opacity ${Math.round(dur * 0.7)}ms ease-in ${Math.round(dur * 0.15)}ms`,
      `filter ${dur}ms ease-in`,
    ].join(', ');
    el.style.height = (heights.get(el) ?? 0) + 'px';
    el.style.opacity = '1';
    el.style.filter = 'blur(0px)';
  }

  // ── Cleanup ──────────────────────────────────────────────────────
  setTimeout(() => {
    clearAnimStyles(body);
    for (const el of toShow) clearAnimStyles(el);
    onComplete?.();
  }, dur + 20);
};
