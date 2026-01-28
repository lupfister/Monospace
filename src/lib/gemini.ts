/**
 * Minimal Gemini API client — uses REST + fetch, no SDK.
 * Uses v1 (stable) and gemini-2.0-flash. gemini-1.5-flash is not supported
 * for generateContent on v1beta; use ListModels to see current models.
 * Keeps prompts short to minimize token usage.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1';
const MODEL = 'gemini-2.0-flash';

export type GeminiAction = 'summarize' | 'improve' | 'expand' | 'review' | 'search';

const getApiKey = (): string => {
  const key = import.meta.env.VITE_GEMINI_API_KEY;
  if (!key) throw new Error('VITE_GEMINI_API_KEY is not set. Add it to .env');
  return key;
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
      return `You are a helpful assistant. The user has shared some text below. Your role is to:

- Answer questions directly and helpfully
- Provide relevant knowledge and context
- Ask thoughtful follow-up questions when appropriate
- Be conversational and engaging

After your response, if you think web search results would be helpful (videos, articles, or images), indicate what to search for by adding ONE of these tags on a new line:
- [SEARCH_VIDEOS: query] - if YouTube videos would be helpful
- [SEARCH_ARTICLES: query] - if articles would be helpful  
- [SEARCH_IMAGES: query] - if images would be helpful
- [SEARCH_ALL: query] - if multiple types would be helpful

Only add a search tag if external content would genuinely add value. Be concise and helpful (2-4 sentences typically).

User's text:\n\n${t}`;
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
