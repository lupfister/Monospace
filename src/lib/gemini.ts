/**
 * Minimal Gemini API client — uses REST + fetch, no SDK.
 * Uses v1beta for Grounding with Google Search (google_search tool).
 * Use ListModels to see which models are available for your key/project.
 * Keeps prompts short to minimize token usage.
 */

// Grounding with Google Search is documented on v1beta.
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.0-flash';

export type GeminiAction = 'summarize' | 'improve' | 'expand' | 'review' | 'search';

const getApiKey = (): string => {
  const key = import.meta.env.VITE_GEMINI_API_KEY;
  if (!key) throw new Error('VITE_GEMINI_API_KEY is not set. Add it to .env');
  return key;
};

export type GeminiSearchType = 'video' | 'image' | 'web';

export type GeminiSearchPlan = {
  shouldSearch: boolean;
  queries: Array<{
    type: GeminiSearchType;
    query: string;
    reason?: string;
  }>;
};

const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const normalizeSearchPlan = (value: unknown): GeminiSearchPlan | null => {
  if (!value || typeof value !== 'object') return null;
  const plan = value as Partial<GeminiSearchPlan>;
  if (typeof plan.shouldSearch !== 'boolean') return null;
  if (!Array.isArray(plan.queries)) return null;

  const normalizedQueries: GeminiSearchPlan['queries'] = [];
  for (const q of plan.queries) {
    if (!q || typeof q !== 'object') continue;
    const qq = q as Partial<GeminiSearchPlan['queries'][number]>;
    if (qq.type !== 'video' && qq.type !== 'image' && qq.type !== 'web') continue;
    const query = typeof qq.query === 'string' ? qq.query.trim() : '';
    if (!query) continue;
    const reason = typeof qq.reason === 'string' ? qq.reason.trim() : undefined;
    normalizedQueries.push({ type: qq.type, query, reason });
  }

  // If the model says "shouldSearch" but doesn't provide queries, treat as no-search.
  if (plan.shouldSearch && normalizedQueries.length === 0) {
    return { shouldSearch: false, queries: [] };
  }

  // Cap to keep UX snappy and prevent accidental tool spam.
  return { shouldSearch: plan.shouldSearch, queries: normalizedQueries.slice(0, 3) };
};

const buildPrompt = (action: GeminiAction, text: string): string => {
  const t = text.slice(0, 4000); // cap input to reduce tokens
  switch (action) {
    case 'summarize':
      return `Summarize in 1–3 short sentences:\n\n${t}`;
    case 'improve':
      return `Improve clarity and grammar. Output only the improved text, no preamble:\n\n${t}`;
    case 'expand':
      return `Expand into 2–4 sentences, keeping the same tone:\n\n${t}`;
    case 'review':
      // Check if the text includes the special format with full context and new text
      const hasContextFormat = t.includes('Full document context:') && t.includes('Focus on this newly written text');
      
      if (hasContextFormat) {
        return `You are writing "skeleton notes" for a document editor.

The user has provided:
1. Full document context (the entire conversation/document so far)
2. Newly written text (the specific text they just wrote, marked with "Focus on this newly written text")

CRITICAL INSTRUCTIONS:
- The document ALREADY EXISTS with previous content, summaries, and questions
- DO NOT regenerate or repeat existing content
- DO NOT create a new "Summary" section if one already exists in the context
- DO NOT repeat questions that were already asked
- Focus ONLY on responding to the newly written text in the context of what already exists
- If the newly written text is a question or needs clarification, provide a direct answer or follow-up question
- If the newly written text adds new information, integrate it contextually (e.g., if they mention "funny eyebrows", provide information about which penguins have that feature)
- Only add NEW content that builds on what's already there

Output MUST be valid JSON only (no markdown, no code fences, no commentary) matching this TypeScript type:
type Block =
  | { kind: "ai"; text: string }
  | { kind: "input"; prompt: string; lines: number };
type Output = { blocks: Block[] };

Rules:
- Keep AI text short and scannable (headings + 1–2 concise sentences, or short bullet-like lines)
- Use "input" blocks ONLY for NEW questions or prompts that aren't already in the document
- For input blocks: prompt is shown in gray; then render exactly "lines" empty user lines to fill in (use 1–4)
- Add 1–3 blocks that directly respond to the newly written text
- If the newly written text asks a question, provide an answer (as an "ai" block) or a clarifying follow-up question (as an "input" block)
- Keep total blocks <= 5 (since this is incremental, not a full document)
- DO NOT include a "Summary" block unless the document context shows there isn't one already

After the JSON, if you think web search results would be helpful, append ONE tag on a new line (outside JSON):
- [SEARCH_VIDEOS: query]
- [SEARCH_ARTICLES: query]
- [SEARCH_IMAGES: query]
- [SEARCH_ALL: query]
Only add a tag if external content would genuinely add value.

User's text:
${t}`;
      } else {
        return `You are writing "skeleton notes" for a document editor.

Output MUST be valid JSON only (no markdown, no code fences, no commentary) matching this TypeScript type:
type Block =
  | { kind: "ai"; text: string }
  | { kind: "input"; prompt: string; lines: number };
type Output = { blocks: Block[] };

Rules:
- Keep AI text short and scannable (headings + 1–2 concise sentences, or short bullet-like lines)
- Use "input" blocks for places where the user should type (questions, prompts, TODO-like blanks)
- For input blocks: prompt is shown in gray; then render exactly "lines" empty user lines to fill in (use 1–4)
- Include a "Summary" section first (as ai blocks), then 2–6 input prompts that guide the user to capture key takeaways.
- If the user's text contains explicit questions, convert them into input prompts.
- Keep total blocks <= 20.

After the JSON, if you think web search results would be helpful, append ONE tag on a new line (outside JSON):
- [SEARCH_VIDEOS: query]
- [SEARCH_ARTICLES: query]
- [SEARCH_IMAGES: query]
- [SEARCH_ALL: query]
Only add a tag if external content would genuinely add value.

User's text:
${t}`;
      }
    case 'search':
      return `Based on this text, suggest what to search for on the web to find helpful YouTube videos, images, and articles. Provide 1-3 specific search queries that would be most useful:\n\n${t}`;
    default:
      return t;
  }
};

export interface GeminiGenerateResult {
  text: string;
  ok: true;
}

export interface GeminiErrorResult {
  ok: false;
  error: string;
}

export type GeminiResult = GeminiGenerateResult | GeminiErrorResult;

export interface GeminiGroundedSearchResult {
  title: string;
  url: string;
  snippet?: string;
}

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: { uri?: string; title?: string };
      }>;
      groundingSupports?: Array<{
        segment?: { text?: string };
        groundingChunkIndices?: number[];
      }>;
    };
  }>;
  error?: { message?: string };
};

/**
 * Call Gemini generateContent (single round-trip, no streaming).
 */
export const generateWithGemini = async (
  action: GeminiAction,
  selectedText: string
): Promise<GeminiResult> => {
  const apiKey = getApiKey();
  const url = `${GEMINI_BASE}/models/${MODEL}:generateContent?key=${apiKey}`;
  const userPrompt = buildPrompt(action, selectedText);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          maxOutputTokens: 512,
          temperature: 0.3,
        },
      }),
    });

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };

    if (!res.ok) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      return { ok: false, error: msg };
    }

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    if (!text) return { ok: false, error: 'Empty response' };

    return { ok: true, text };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
};

/**
 * Use Gemini's built-in Google Search grounding to fetch sources/links.
 * Returns a small set of unique web results (title + url + optional snippet).
 */
export const searchWithGemini = async (
  query: string,
  options: { maxResults?: number } = {}
): Promise<GeminiGroundedSearchResult[]> => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const apiKey = getApiKey();
  const url = `${GEMINI_BASE}/models/${MODEL}:generateContent?key=${apiKey}`;

  const maxResults = Math.max(1, Math.min(options.maxResults ?? 10, 20));

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ 
              text: trimmedQuery.toLowerCase().includes('image') || trimmedQuery.toLowerCase().includes('picture')
                ? `Find images and image sources for: ${trimmedQuery}`
                : `Search the web for: ${trimmedQuery}`
            }],
          },
        ],
        // REST API uses snake_case for this tool name.
        // (The JS SDK uses camelCase `googleSearch`.)
        tools: [{ google_search: {} }],
        generationConfig: {
          // We don't need a long answer; we mainly want grounding metadata (sources).
          maxOutputTokens: 128,
          temperature: 0,
        },
      }),
    });

    const data = (await res.json()) as GeminiGenerateContentResponse;

    if (!res.ok) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      console.warn('Gemini grounded search failed:', {
        status: res.status,
        message: msg,
        hasGroundingMetadata: Boolean(data.candidates?.[0]?.groundingMetadata),
      });
      return [];
    }

    const candidate = data.candidates?.[0];
    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    const supports = candidate?.groundingMetadata?.groundingSupports ?? [];

    const results: GeminiGroundedSearchResult[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < chunks.length; i += 1) {
      const web = chunks[i]?.web;
      const urlValue = web?.uri?.trim() ?? '';
      if (!urlValue) continue;
      if (seen.has(urlValue)) continue;

      const title = web?.title?.trim() || urlValue;

      // Best-effort: pick a small snippet from a support segment that references this chunk.
      const snippet =
        supports.find((s) => (s.groundingChunkIndices ?? []).includes(i))
          ?.segment?.text?.trim() ?? undefined;

      results.push({ title, url: urlValue, snippet });
      seen.add(urlValue);

      if (results.length >= maxResults) break;
    }

    return results;
  } catch {
    return [];
  }
};

/**
 * Ask Gemini to produce a structured search plan (agentic "decide + query").
 * The caller executes searches and optionally does a second synthesis pass.
 */
export const planSearchWithGemini = async (text: string): Promise<GeminiSearchPlan> => {
  const apiKey = getApiKey();
  const url = `${GEMINI_BASE}/models/${MODEL}:generateContent?key=${apiKey}`;
  const t = text.slice(0, 4000);

  const prompt = `You are a search planning assistant for a writing app.
Decide if web retrieval would add meaningful value. If yes, output up to 3 searches.

Return ONLY valid JSON matching this TypeScript type:
type Plan = {
  shouldSearch: boolean;
  queries: Array<{ type: "web" | "image" | "video"; query: string; reason?: string }>;
};

Rules:
- If the text is self-contained, set shouldSearch=false and queries=[]
- Queries must be concrete (include key nouns, versions, dates, or context)
- Prefer "web" unless the user would benefit specifically from visuals or videos
- Don't include markdown, commentary, or code fences; JSON only

Text:
${t}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 256,
          temperature: 0.1,
        },
      }),
    });

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };
    if (!res.ok) return { shouldSearch: false, queries: [] };

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    if (!raw) return { shouldSearch: false, queries: [] };

    const parsed = safeJsonParse(raw);
    const normalized = normalizeSearchPlan(parsed);
    return normalized ?? { shouldSearch: false, queries: [] };
  } catch {
    return { shouldSearch: false, queries: [] };
  }
};
