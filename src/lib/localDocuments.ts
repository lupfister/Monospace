export type LocalDocument = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  content: string;
  aiReviewedAt?: string;
  aiExcerpt?: string;
  aiExcerptUpdatedAt?: string;
  aiReviewAttemptedAt?: string;
};

const STORAGE_KEY = 'monospace.documents.v1';
const LEGACY_KEY = 'documentContent';

const nowIso = () => new Date().toISOString();

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const stripHtml = (value: string) => value.replace(/<[^>]*>/g, ' ');

const isPlaceholderContent = (content: string) =>
  normalizeWhitespace(stripHtml(content)) === 'Start writing...';

const deriveTitleFromContent = (content: string) => {
  const text = normalizeWhitespace(stripHtml(content));
  return text ? text.slice(0, 64) : 'Untitled';
};

const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `doc_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const coerceDocument = (raw: Partial<LocalDocument> | null): LocalDocument | null => {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : createId();
  const content = typeof raw.content === 'string' ? raw.content : '';
  const fallbackTitle = content ? deriveTitleFromContent(content) : 'Untitled';
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : fallbackTitle;
  const createdAt = typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : nowIso();
  const updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : createdAt;
  const aiReviewedAt = typeof raw.aiReviewedAt === 'string' && raw.aiReviewedAt ? raw.aiReviewedAt : undefined;
  const aiExcerpt = typeof raw.aiExcerpt === 'string' && raw.aiExcerpt.trim() ? raw.aiExcerpt.trim() : undefined;
  const aiExcerptUpdatedAt = typeof raw.aiExcerptUpdatedAt === 'string' && raw.aiExcerptUpdatedAt
    ? raw.aiExcerptUpdatedAt
    : undefined;
  const aiReviewAttemptedAt = typeof raw.aiReviewAttemptedAt === 'string' && raw.aiReviewAttemptedAt
    ? raw.aiReviewAttemptedAt
    : undefined;
  return {
    id,
    title,
    createdAt,
    updatedAt,
    content,
    aiReviewedAt,
    aiExcerpt,
    aiExcerptUpdatedAt,
    aiReviewAttemptedAt,
  };
};

export const createLocalDocument = (content: string = ''): LocalDocument => {
  const now = nowIso();
  const safeContent = isPlaceholderContent(content) ? '' : content;
  return {
    id: createId(),
    title: safeContent ? deriveTitleFromContent(safeContent) : 'Untitled',
    createdAt: now,
    updatedAt: now,
    content: safeContent,
  };
};

export const persistDocuments = (documents: LocalDocument[]) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(documents));
};

export const loadDocuments = (): LocalDocument[] => {
  if (typeof window === 'undefined') return [];

  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const docs = parsed
          .map((doc) => coerceDocument(doc))
          .filter((doc): doc is LocalDocument => Boolean(doc));
        return docs;
      }
    } catch {
      // Ignore malformed storage
    }
  }

  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy !== null) {
    const migrated = [createLocalDocument(legacy)];
    persistDocuments(migrated);
    localStorage.removeItem(LEGACY_KEY);
    return migrated;
  }

  return [];
};
