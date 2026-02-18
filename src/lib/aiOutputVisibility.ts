import { isAiTextSpan, isHumanTextSpan } from './textStyles';

const AI_HIDE_DURATION = 300; // ms
const AI_HIDE_SCALE = 0.7;
const AI_HIDE_SHIFT_Y = -6; // px

const removeAttributeFromAll = (root: HTMLElement, selector: string, attr: string) => {
  root.querySelectorAll(selector).forEach((el) => {
    (el as HTMLElement).removeAttribute(attr);
  });
};

export const clearAiHiddenState = (root: HTMLElement, options: { preserveLinebreaks?: boolean } = {}) => {
  removeAttributeFromAll(root, '[data-ai-hidden="true"]', 'data-ai-hidden');
  removeAttributeFromAll(root, '[data-ai-contains-highlight="true"]', 'data-ai-contains-highlight');
  removeAttributeFromAll(root, '[data-ai-show-highlight="true"]', 'data-ai-show-highlight');
  if (!options.preserveLinebreaks) {
    root.querySelectorAll('[data-ai-linebreak="true"]').forEach((linebreak) => linebreak.remove());
  }
  root.querySelectorAll('[data-ai-highlight-clone="true"]').forEach((clone) => clone.remove());
};

const ensureAiLinebreaks = (root: HTMLElement) => {
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

export const applyAiHiddenState = (root: HTMLElement, options: { preserveLinebreaks?: boolean } = {}) => {
  clearAiHiddenState(root, options);

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

  ensureAiLinebreaks(root);
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
  'padding-top', 'padding-bottom', 'min-height', 'transform',
  'position', 'top', 'left', 'width', 'pointer-events',
] as const;

/** Clean up inline animation styles from an element. */
const clearAnimStyles = (el: HTMLElement) => {
  for (const prop of ANIM_PROPS) el.style.removeProperty(prop);
};

const createAnimationClone = (el: HTMLElement, rect: DOMRect) => {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.setAttribute('data-ai-anim-clone', 'true');
  clone.contentEditable = 'false';
  clone.style.position = 'fixed';
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.margin = '0';
  clone.style.pointerEvents = 'none';
  clone.style.transformOrigin = 'top';
  clone.style.zIndex = '1000';
  document.body.appendChild(clone);
  return clone;
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
  const persistent: HTMLElement[] = [];
  for (const child of children) {
    if (!hasPersistentContent(child)) {
      toHide.push(child);
    } else {
      persistent.push(child);
    }
  }

  if (toHide.length === 0) {
    applyAiHiddenState(body);
    onComplete?.();
    return;
  }

  // ── Measure ──────────────────────────────────────────────────────
  ensureAiLinebreaks(body);
  const startHeight = body.offsetHeight;
  const persistentStart = new Map<HTMLElement, DOMRect>();
  const toHideRects = new Map<HTMLElement, DOMRect>();
  for (const el of persistent) persistentStart.set(el, el.getBoundingClientRect());
  for (const el of toHide) toHideRects.set(el, el.getBoundingClientRect());

  const clones: HTMLElement[] = [];
  for (const el of toHide) {
    const rect = toHideRects.get(el);
    if (!rect) continue;
    clones.push(createAnimationClone(el, rect));
  }

  applyAiHiddenState(body, { preserveLinebreaks: true });
  const targetHeight = body.offsetHeight;
  const persistentEnd = new Map<HTMLElement, DOMRect>();
  for (const el of persistent) persistentEnd.set(el, el.getBoundingClientRect());
  const persistentDeltas = new Map<HTMLElement, { x: number; y: number }>();
  for (const el of persistent) {
    const startRect = persistentStart.get(el);
    const endRect = persistentEnd.get(el);
    if (!startRect || !endRect) continue;
    const dx = startRect.left - endRect.left;
    const dy = startRect.top - endRect.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      persistentDeltas.set(el, { x: dx, y: dy });
    }
  }

  // ── Lock starting state ──────────────────────────────────────────
  // Body container — controls external layout
  body.style.height = startHeight + 'px';
  body.style.overflow = 'hidden';
  body.style.willChange = 'height';

  for (const el of persistent) {
    const delta = persistentDeltas.get(el);
    if (!delta) continue;
    el.style.transform = `translate(${delta.x}px, ${delta.y}px)`;
    el.style.willChange = 'transform';
  }

  void body.offsetHeight;                       // commit starting values

  // ── Animate ──────────────────────────────────────────────────────
  const dur = AI_HIDE_DURATION;
  const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';

  requestAnimationFrame(() => {
    body.style.transition = `height ${dur}ms ${ease}`;
    body.style.height = targetHeight + 'px';

    for (const el of persistent) {
      if (!persistentDeltas.has(el)) continue;
      el.style.transition = `transform ${dur}ms ${ease}`;
      el.style.transform = 'translate(0px, 0px)';
    }

    clones.forEach((clone) => {
      clone.style.transition = [
        `opacity ${Math.round(dur * 0.55)}ms ease-out`,
        `filter ${dur}ms ease-out`,
        `transform ${dur}ms ease-out`,
      ].join(', ');
      clone.style.opacity = '0';
      clone.style.filter = 'blur(4px)';
      clone.style.transform = `scaleY(${AI_HIDE_SCALE}) translateY(${AI_HIDE_SHIFT_Y}px)`;
    });
  });

  // ── Cleanup ──────────────────────────────────────────────────────
  setTimeout(() => {
    clearAnimStyles(body);
    for (const el of persistent) clearAnimStyles(el);
    clones.forEach((clone) => clone.remove());
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
  const persistent: HTMLElement[] = [];
  for (const child of children) {
    if (child.getAttribute('data-ai-ui') === 'true') continue;
    if (child.getAttribute('data-ai-output-toggle') === 'true') continue;
    const isAi =
      child.getAttribute('data-ai-text') === 'true' ||
      child.getAttribute('data-ai-origin') === 'true' ||
      child.getAttribute('data-ai-question') === 'true';
    if (isAi) {
      toShow.push(child);
    } else if (hasPersistentContent(child)) {
      persistent.push(child);
    }
  }

  if (toShow.length === 0) {
    onComplete?.();
    return;
  }

  // ── Measure ──────────────────────────────────────────────────────
  const startHeight = body.offsetHeight;
  const persistentStart = new Map<HTMLElement, DOMRect>();
  for (const el of persistent) persistentStart.set(el, el.getBoundingClientRect());

  clearAiHiddenState(body, { preserveLinebreaks: true });

  const targetHeight = body.offsetHeight;
  const persistentEnd = new Map<HTMLElement, DOMRect>();
  for (const el of persistent) persistentEnd.set(el, el.getBoundingClientRect());
  const persistentDeltas = new Map<HTMLElement, { x: number; y: number }>();
  for (const el of persistent) {
    const startRect = persistentStart.get(el);
    const endRect = persistentEnd.get(el);
    if (!startRect || !endRect) continue;
    const dx = startRect.left - endRect.left;
    const dy = startRect.top - endRect.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      persistentDeltas.set(el, { x: dx, y: dy });
    }
  }

  // ── Lock starting state ──────────────────────────────────────────
  body.style.height = startHeight + 'px';
  body.style.overflow = 'visible';
  body.style.willChange = 'height';

  for (const el of persistent) {
    const delta = persistentDeltas.get(el);
    if (!delta) continue;
    el.style.transform = `translate(${delta.x}px, ${delta.y}px)`;
    el.style.willChange = 'transform';
  }

  for (const el of toShow) {
    el.style.opacity = '0';
    el.style.filter = 'blur(4px)';
    el.style.transform = `scaleY(${AI_HIDE_SCALE}) translateY(${AI_HIDE_SHIFT_Y}px)`;
    el.style.transformOrigin = 'top';
    el.style.willChange = 'opacity, filter, transform';
  }

  void body.offsetHeight;                       // commit starting values

  // ── Animate ──────────────────────────────────────────────────────
  const dur = AI_HIDE_DURATION;
  const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';

  requestAnimationFrame(() => {
    body.style.transition = `height ${dur}ms ${ease}`;
    body.style.height = targetHeight + 'px';

    for (const el of persistent) {
      if (!persistentDeltas.has(el)) continue;
      el.style.transition = `transform ${dur}ms ${ease}`;
      el.style.transform = 'translate(0px, 0px)';
    }

    for (const el of toShow) {
      el.style.transition = [
        `opacity ${Math.round(dur * 0.7)}ms ease-in ${Math.round(dur * 0.15)}ms`,
        `filter ${dur}ms ease-in`,
        `transform ${dur}ms ease-in`,
      ].join(', ');
      el.style.opacity = '1';
      el.style.filter = 'blur(0px)';
      el.style.transform = 'scaleY(1) translateY(0px)';
    }
  });

  // ── Cleanup ──────────────────────────────────────────────────────
  setTimeout(() => {
    for (const el of toShow) clearAnimStyles(el);
    requestAnimationFrame(() => {
      clearAnimStyles(body);
      for (const el of persistent) clearAnimStyles(el);
      clearAiHiddenState(body);
      onComplete?.();
    });
  }, dur + 20);
};
