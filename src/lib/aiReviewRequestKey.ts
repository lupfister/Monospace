import type { ContextBlock } from './openaiAgentApi';

type ReviewMode = 'manual' | 'auto';

type CreateReviewRequestKeyInput = {
  docId: string;
  text: string;
  model?: string | null;
  context?: ContextBlock[];
  mode: ReviewMode;
};

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const hashString = (value: string) => {
  // FNV-1a 32-bit hash for deterministic idempotency keys.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const serializeContext = (context?: ContextBlock[]) => {
  if (!context || context.length === 0) return '';
  return context
    .map((block) => {
      const source = block.source || 'human';
      const highlighted = block.highlighted ? '1' : '0';
      const updatedAt = block.updatedAt ?? 0;
      const text = normalizeWhitespace(block.text || '');
      return `${source}:${highlighted}:${updatedAt}:${text}`;
    })
    .join('|');
};

export const createReviewRequestKey = ({
  docId,
  text,
  model,
  context,
  mode,
}: CreateReviewRequestKeyInput) => {
  const payload = [
    'review:v1',
    mode,
    docId || 'unknown-doc',
    model || 'default-model',
    normalizeWhitespace(text),
    serializeContext(context),
  ].join('||');

  return `review:v1:${mode}:${docId || 'unknown-doc'}:${hashString(payload)}`;
};
