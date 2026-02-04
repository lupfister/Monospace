export type GeminiAction = 'summarize' | 'improve' | 'expand' | 'review' | 'search';

export type GeminiSearchType = 'video' | 'image' | 'web';

export type GeminiSearchPlan = {
  shouldSearch: boolean;
  queries: Array<{
    type: GeminiSearchType;
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

export interface GeminiGenerateResult {
  text: string;
  ok: true;
}

export interface GeminiErrorResult {
  ok: false;
  error: string;
}

export type GeminiResult = GeminiGenerateResult | GeminiErrorResult;

type AiAction = 'summarize' | 'improve' | 'expand' | 'review' | 'plan_search';

const mapGeminiActionToAiAction = (action: GeminiAction): AiAction => {
  if (action === 'search') return 'plan_search';
  return action;
};

const postAiAction = async <TResponse>(body: {
  action: AiAction;
  text: string;
  model?: string | null;
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

export const generateWithGemini = async (
  action: GeminiAction,
  selectedText: string,
  model?: string | null,
): Promise<GeminiResult> => {
  const trimmed = selectedText.trim();
  if (!trimmed) {
    return { ok: false, error: 'No text provided.' };
  }

  const aiAction = mapGeminiActionToAiAction(action);

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

export const planSearchWithGemini = async (
  text: string,
  model?: string | null,
): Promise<GeminiSearchPlan> => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { shouldSearch: false, queries: [] };
  }

  try {
    const data = await postAiAction<{
      ok: boolean;
      plan?: GeminiSearchPlan;
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

    const normalizedQueries: GeminiSearchPlan['queries'] = [];
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
      queries: normalizedQueries.slice(0, 3),
    };
  } catch {
    return { shouldSearch: false, queries: [] };
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

