export type StoredViewedSource = {
  url: string;
  label: string;
  context?: string;
};

export type AiOutputSourcesIndex = Record<string, Record<string, StoredViewedSource[]>>;

const STORAGE_KEY = 'monospace.aiOutputSources.v1';

const createAiOutputId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `ai_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export const ensureAiOutputId = (output: HTMLElement): string => {
  const existing = output.dataset.aiOutputId;
  if (existing) return existing;
  const next = createAiOutputId();
  output.dataset.aiOutputId = next;
  return next;
};

export const loadAiOutputSources = (): AiOutputSourcesIndex => {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as AiOutputSourcesIndex;
    }
  } catch {
    // Ignore malformed storage
  }
  return {};
};

export const persistAiOutputSources = (index: AiOutputSourcesIndex): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
};

export const extractViewedSourcesFromOutput = (output: HTMLElement): StoredViewedSource[] => {
  const list = output.querySelector<HTMLElement>('[data-viewed-sources-list="true"]')
    ?? (output.querySelector<HTMLElement>('[data-viewed-sources-header="true"]')?.nextElementSibling as HTMLElement | null);
  if (!list) return [];
  const links = Array.from(list.querySelectorAll<HTMLElement>('[data-source-url]'));
  const seen = new Set<string>();
  const sources: StoredViewedSource[] = [];
  links.forEach((link) => {
    const url = (link.dataset.sourceUrl || '').trim();
    if (!url || seen.has(url)) return;
    const label = (link.dataset.sourceLabel || '').trim() || url;
    const container = link.closest<HTMLElement>('[data-source-item="true"]');
    const context = container?.dataset.sourceContext?.trim();
    sources.push({ url, label, ...(context ? { context } : {}) });
    seen.add(url);
  });
  return sources;
};

export const persistViewedSourcesForOutput = (docId: string, output: HTMLElement): string => {
  const outputId = ensureAiOutputId(output);
  if (typeof window === 'undefined') return outputId;
  const sources = extractViewedSourcesFromOutput(output);
  if (sources.length === 0) return outputId;
  const index = loadAiOutputSources();
  const docEntry = index[docId] ? { ...index[docId] } : {};
  docEntry[outputId] = sources;
  index[docId] = docEntry;
  persistAiOutputSources(index);
  return outputId;
};

export const persistViewedSourcesForDoc = (docId: string, root: HTMLElement | null): void => {
  if (!root || typeof window === 'undefined') return;
  const outputs = Array.from(root.querySelectorAll<HTMLElement>('[data-ai-output="true"]'));
  if (outputs.length === 0) return;
  const index = loadAiOutputSources();
  const docEntry: Record<string, StoredViewedSource[]> = {};
  outputs.forEach((output) => {
    const outputId = ensureAiOutputId(output);
    const sources = extractViewedSourcesFromOutput(output);
    docEntry[outputId] = sources;
  });
  index[docId] = docEntry;
  persistAiOutputSources(index);
};
