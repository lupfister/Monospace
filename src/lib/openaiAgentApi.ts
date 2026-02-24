export type AiAction = 'summarize' | 'improve' | 'expand' | 'review' | 'search' | 'explore_source' | 'title';

export type SearchType = 'video' | 'image' | 'web';

export type SearchPlan = {
  shouldSearch: boolean;
  queries: Array<{
    type: SearchType;
    query: string;
    reason?: string;
  }>;
};

export type AgentSearchType = 'video' | 'article' | 'image';

export interface AgentSearchResult {
  type: AgentSearchType;
  title: string;
  url: string;
  snippet?: string;
  thumbnail?: string;
}

export interface AgentSearchRequest {
  type: AgentSearchType;
  query: string;
}

export interface GenerateResult {
  text: string;
  ok: true;
}

export type SkeletonNoteBlock =
  | { kind: 'ai'; text: string }
  | { kind: 'input'; prompt: string; lines: number };

export interface SkeletonNotes {
  blocks: SkeletonNoteBlock[];
  searchTag?: string;
}

export interface ErrorResult {
  ok: false;
  error: string;
}

export type AiResult = GenerateResult | ErrorResult;

// Structured error type for better UX
export interface AiError {
  type: 'network' | 'rate_limit' | 'content_policy' | 'no_results' | 'cancelled' | 'validation' | 'unknown';
  message: string;
  suggestion?: string;
}

// Unified review result
export interface FullReviewResult {
  plan: SearchPlan;
  searchResults: AgentSearchResult[];
  narrative: SkeletonNotes;
}

export interface ContextBlock {
  source: 'human' | 'ai';
  text: string;
  updatedAt?: number;
  highlighted?: boolean;
}

type InternalAiAction = 'summarize' | 'improve' | 'expand' | 'review' | 'plan_search' | 'explore_source' | 'title';

const mapActionToInternal = (action: AiAction): InternalAiAction => {
  if (action === 'search') return 'plan_search';
  return action;
};

const postAiAction = async <TResponse>(body: {
  action: InternalAiAction;
  text: string;
  model?: string | null;
  searchContext?: unknown;
  context?: ContextBlock[];
  previousContext?: string;
}): Promise<TResponse> => {
  try {
    const res = await fetch('/api/ai/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as TResponse & { ok?: boolean; error?: string };

    if (!res.ok || data.ok === false) {
      const errorMessage =
        (data as any).error || `AI request failed with status ${res.status}`;
      throw new Error(errorMessage);
    }

    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
};

export const generateWithOpenAI = async (
  action: AiAction,
  selectedText: string,
  model?: string | null,
): Promise<AiResult> => {
  const trimmed = selectedText.trim();
  if (!trimmed) {
    return { ok: false, error: 'No text provided.' };
  }

  const aiAction = mapActionToInternal(action);

  try {
    const data = await postAiAction<{ ok: boolean; text: string }>({
      action: aiAction,
      text: trimmed,
      model: model ?? undefined,
    });

    if (!data.ok || !data.text) {
      return {
        ok: false,
        error: 'Empty response from AI.',
      };
    }

    return { ok: true, text: data.text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
};

export const fetchSkeletonNotes = async (
  text: string,
  model?: string | null,
  searchContext?: unknown,
): Promise<{ ok: boolean; notes?: SkeletonNotes; error?: string }> => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: 'No text provided.' };
  }

  try {
    const data = await postAiAction<{ ok: boolean; text: string }>({
      action: 'review',
      text: trimmed,
      model: model ?? undefined,
      ...(searchContext ? { searchContext } : {}),
    });

    if (!data.ok || !data.text) {
      return { ok: false, error: 'Empty response from AI.' };
    }

    const textOutput = data.text;
    const jsonEndIndex = textOutput.lastIndexOf('}') + 1;
    const jsonPart = textOutput.slice(0, jsonEndIndex).trim();
    const tagPart = textOutput.slice(jsonEndIndex).trim();

    try {
      const parsed = JSON.parse(jsonPart) as { blocks: SkeletonNoteBlock[] };
      return {
        ok: true,
        notes: {
          blocks: parsed.blocks || [],
          searchTag: tagPart || undefined,
        },
      };
    } catch (e) {
      console.error('Failed to parse skeleton notes JSON:', e, 'Raw output:', textOutput);
      return { ok: false, error: 'Invalid response format from AI.' };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
};

export const planSearch = async (
  text: string,
  model?: string | null,
): Promise<SearchPlan> => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { shouldSearch: false, queries: [] };
  }

  try {
    const data = await postAiAction<{
      ok: boolean;
      plan?: SearchPlan;
    }>({
      action: 'plan_search',
      text: trimmed,
      model: model ?? undefined,
    });

    if (!data.ok || !data.plan) {
      return { shouldSearch: false, queries: [] };
    }

    const plan = data.plan;
    if (
      typeof plan.shouldSearch !== 'boolean' ||
      !Array.isArray(plan.queries)
    ) {
      return { shouldSearch: false, queries: [] };
    }

    const normalizedQueries: SearchPlan['queries'] = [];
    for (const q of plan.queries) {
      if (!q || typeof q !== 'object') continue;
      const type = q.type;
      if (type !== 'video' && type !== 'image' && type !== 'web') continue;
      const query = typeof q.query === 'string' ? q.query.trim() : '';
      if (!query) continue;
      const reason =
        typeof q.reason === 'string' ? q.reason.trim() : undefined;
      normalizedQueries.push({ type, query, reason });
    }

    if (plan.shouldSearch && normalizedQueries.length === 0) {
      return { shouldSearch: false, queries: [] };
    }

    return {
      shouldSearch: plan.shouldSearch,
      queries: normalizedQueries,
    };
  } catch {
    return { shouldSearch: false, queries: [] };
  }
};

export const exploreSource = async (
  url: string,
  model?: string | null,
  previousContext?: string,
): Promise<{ ok: boolean; text?: string; error?: string }> => {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, error: 'No URL provided.' };
  }

  try {
    const data = await postAiAction<{ ok: boolean; text: string }>({
      action: 'explore_source',
      text: trimmed,
      model: model ?? undefined,
      previousContext,
    });

    if (!data.ok || !data.text) {
      return { ok: false, error: 'Empty response from AI.' };
    }

    return { ok: true, text: data.text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
};

export const searchWithAgent = async (
  queries: AgentSearchRequest[],
  model?: string | null,
): Promise<AgentSearchResult[]> => {
  const response = await fetch('/api/ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ queries, model: model ?? undefined }),
  });

  const data = (await response.json()) as {
    ok?: boolean;
    error?: string;
    results?: AgentSearchResult[];
  };

  if (!response.ok || data.ok === false) {
    const message = data.error || `Search request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (!data.results) {
    return [];
  }

  return data.results;
};

/**
 * Unified review function - calls the batched /api/ai/review endpoint
 * which handles planning, parallel search, and narrative generation in one call.
 * Supports cancellation via AbortSignal.
 */
export const fullReview = async (
  text: string,
  model?: string | null,
  signal?: AbortSignal,
  context?: ContextBlock[]
): Promise<{ ok: true; data: FullReviewResult } | { ok: false; error: AiError }> => {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: { type: 'validation', message: 'No text provided.' }
    };
  }

  try {
    const res = await fetch('/api/ai/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed, model: model ?? undefined, context }),
      signal,
    });

    const data = await res.json();

    if (!res.ok || data.ok === false) {
      const errorObj = data.error;
      return {
        ok: false,
        error: typeof errorObj === 'object' && errorObj !== null
          ? {
            type: errorObj.type || 'unknown',
            message: errorObj.message || 'Request failed',
            suggestion: getSuggestionForError(errorObj.type),
          }
          : { type: 'unknown', message: String(errorObj) || 'Request failed' }
      };
    }

    return {
      ok: true,
      data: {
        plan: data.plan,
        searchResults: data.searchResults || [],
        narrative: data.narrative || { blocks: [] },
      }
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return {
        ok: false,
        error: { type: 'cancelled', message: 'Request cancelled' }
      };
    }
    return {
      ok: false,
      error: {
        type: 'network',
        message: error instanceof Error ? error.message : 'Network error',
        suggestion: 'Check your internet connection and try again.'
      }
    };
  }
};

function getSuggestionForError(type: string): string | undefined {
  switch (type) {
    case 'rate_limit':
      return 'Please wait a moment and try again.';
    case 'network':
      return 'Check your internet connection and try again.';
    case 'content_policy':
      return 'Try rephrasing your text to avoid potentially sensitive content.';
    case 'validation':
      return 'Please provide some text to review.';
    default:
      return undefined;
  }
}

/**
 * OpenAI model IDs that work with the Agents API + hosted web search.
 * GPT-5 series only.
 */
export const OPENAI_MODEL_OPTIONS: readonly string[] = [
  'gpt-5.2-pro',
  'gpt-5.2',
  'gpt-5.1',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
];
