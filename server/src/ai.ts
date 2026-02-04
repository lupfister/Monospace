import { Agent, run, webSearchTool } from '@openai/agents';
import { z } from 'zod';

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

const SEARCH_PLAN_SCHEMA = z.object({
  shouldSearch: z.boolean(),
  queries: z
    .array(
      z.object({
        type: (z.enum as any)(['video', 'image', 'web']),
        query: z.string().min(1),
        reason: z.string().optional(),
      }),
    )
    .max(3),
});

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export const AI_MODELS = [
  { id: 'gpt-4o-mini', label: 'Default', description: 'Cheapest, full support' },
  { id: 'gpt-4.1-mini', label: 'Balanced', description: 'Mid-tier' },
  { id: 'gpt-4.1', label: 'Strongest', description: 'Best quality' },
] as const;

const getModel = (model?: string | null): string => {
  if (model && typeof model === 'string' && model.trim()) return model.trim();
  return DEFAULT_MODEL;
};

/** gpt-4.1-nano does not support web_search_preview; use mini for search when nano is requested. */
const getModelForSearch = (modelOverride?: string | null): string => {
  const requested = getModel(modelOverride);
  if (requested === 'gpt-4.1-nano') return 'gpt-4.1-mini';
  return requested;
};

const ensureApiKey = () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Add it to your server environment.');
  }
};

const runBasicAgent = async (
  instructions: string,
  userPrompt: string,
  modelOverride?: string | null,
): Promise<string> => {
  ensureApiKey();
  const model = getModel(modelOverride);

  const agent = new Agent({
    name: 'DocumentAssistant',
    instructions,
    model,
  });

  const result = await run(agent, userPrompt);

  const output = (result as any).finalOutput;
  if (typeof output === 'string') {
    return output.trim();
  }
  return String(output ?? '').trim();
};

export const handleSummarize = async (text: string, model?: string | null): Promise<string> => {
  const prompt = `Summarize the following text in 1–3 short sentences. Keep it concise and clear.\n\nText:\n${text.slice(
    0,
    4000,
  )}`;
  return runBasicAgent(
    'You are a concise writing assistant. Always respond with plain text only, no markdown or bullet points unless explicitly requested.',
    prompt,
    model,
  );
};

export const handleImprove = async (text: string, model?: string | null): Promise<string> => {
  const prompt = `Improve the clarity and grammar of the following text. Preserve the original meaning and tone.\n\nReturn only the improved text, with no explanations or commentary.\n\nText:\n${text.slice(
    0,
    4000,
  )}`;
  return runBasicAgent(
    'You are a careful editor. You only return the edited text, never explanations.',
    prompt,
    model,
  );
};

export const handleExpand = async (text: string, model?: string | null): Promise<string> => {
  const prompt = `Expand the following text into 2–4 sentences, keeping the same tone and style.\n\nReturn only the expanded text with no commentary.\n\nText:\n${text.slice(
    0,
    4000,
  )}`;
  return runBasicAgent(
    'You are a writing assistant that elaborates on ideas. You only return the expanded text.',
    prompt,
    model,
  );
};

export const handleReviewSkeletonNotes = async (text: string, model?: string | null, searchContext?: string): Promise<string> => {
  const t = text.slice(0, 4000);

  const prompt = `You are writing "skeleton notes" for a document editor. The app will display content in this order: (1) images and video embeds (inserted by the app from search), (2) your information section, (3) your questions. You must output ONLY the information section and the questions. Do NOT output "Video link:", "Image link:", or any raw URLs. Do NOT describe or reference specific videos or images—the app inserts those above your response.

Output MUST be valid JSON only (no markdown, no code fences, no commentary) matching this TypeScript type:
type Block =
  | { kind: "ai"; text: string }
  | { kind: "input"; prompt: string; lines: number };
type Output = { blocks: Block[] };

Output order (strict):
1. Information section first: exactly ONE "ai" block with a single paragraph (2–4 sentences max). Include teaching content, facts, and context. Keep it concise and readable. If a relevant article adds value, include ONE additional "ai" block that is a short excerpt (1–2 sentences max) and include a markdown link in that excerpt, e.g. [article title or description](https://example.com).
2. Questions last: one or more "input" blocks only. Each must be a genuine question that takes the learning in a new, unexpected direction—not recap, not obvious follow-ups. Use "input" blocks: prompt is shown in gray; then render exactly "lines" empty user lines to fill in (use 1–4).

Rules:
- Do NOT output any text that says "Video link:", "Image link:", or raw URLs. The app inserts media blocks above your response.
- Do NOT add a "Summary" section unless the user's text explicitly asks for one.
- Do NOT output more than two "ai" blocks total.
- If the user's text asks a question, answer it in the information section (as an "ai" block) and still end with 1–3 open-ended questions that open new directions.
- Keep total blocks <= 12.

After the JSON, if you think web search results would be helpful, append ONE tag on a new line (outside JSON):
- [SEARCH_VIDEOS: query]
- [SEARCH_ARTICLES: query]
- [SEARCH_IMAGES: query]
- [SEARCH_ALL: query]
Only add a tag if external content would genuinely add value.

  const finalPrompt = `${ prompt }

${
    searchContext ? `Context from web search (incorporate relevant findings into the information section where helpful, but do not explicitly cite "search results"):
${searchContext}` : ''
  }

User's text:
${ t } `;

  return runBasicAgent(
    'You are a note-taking assistant that outputs ONLY JSON matching the specified TypeScript type, optionally followed by a single [SEARCH_*] tag.',
    finalPrompt,
    model,
  );
};

export const handlePlanSearch = async (text: string, model?: string | null): Promise<GeminiSearchPlan> => {
  ensureApiKey();
  // Use same model as search so plan quality matches execution (nano doesn't support web search; plan with mini).
  const modelToUse = getModelForSearch(model);

  const t = text.slice(0, 4000);

  const prompt = `You are a search planning assistant for a writing app.
Decide if web retrieval would add meaningful value.If yes, output up to 3 searches.

Return ONLY valid JSON matching this TypeScript type:
  type Plan = {
    shouldSearch: boolean;
    queries: Array<{ type: "web" | "image" | "video"; query: string; reason?: string }>;
  };

  Rules:
  - If the text is self - contained, set shouldSearch = false and queries = []
    - Queries must be concrete(include key nouns, versions, dates, or context)
      - Make queries specific and interesting, not generic("pixabay", "stock photo", or "wikipedia" is too generic)
        - Prefer high - signal, reputable, or surprising sources the user can react to
          - Prefer "web" unless the user would benefit specifically from visuals or videos
            - For type "image": use queries that ask for contextually relevant visuals(e.g. "Microsoft Word .doc file icon screenshot", "Word document format diagram") so results are real screenshots, icons, or diagrams—not generic words like "doc" or "document" which return conversion - tool logos and lettermarks.
- Don't include markdown, commentary, or code fences; JSON only

  Text:
${ t } `;

  const agent = new Agent({
    name: 'SearchPlanner',
    instructions:
      'You decide whether web search is useful and propose up to 3 concrete search queries. You must return strict JSON per the provided Plan type and nothing else.',
    model: modelToUse,
  });

  const result = await run(agent, prompt);
  const output = (result as any).finalOutput;
  const raw = typeof output === 'string' ? output.trim() : String(output ?? '').trim();

  try {
    const parsed = JSON.parse(raw);
    const validated = SEARCH_PLAN_SCHEMA.safeParse(parsed);
    if (!validated.success) {
      return { shouldSearch: false, queries: [] };
    }
    return validated.data;
  } catch {
    return { shouldSearch: false, queries: [] };
  }
};

export type AgentSearchResultType = 'video' | 'article' | 'image';

export interface AgentSearchQuery {
  type: AgentSearchResultType;
  query: string;
  reason?: string;
}

export interface AgentSearchResult {
  type: AgentSearchResultType;
  title: string;
  url: string;
  snippet?: string;
  thumbnail?: string;
}

const AGENT_SEARCH_ITEM_SCHEMA = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
  snippet: z.string().optional(),
  thumbnail: z.string().optional(),
});

const AGENT_SEARCH_RESPONSE_SCHEMA = z.object({
  results: z.array(AGENT_SEARCH_ITEM_SCHEMA).max(8),
});

const AGENT_SEARCH_QUERY_SCHEMA = z.object({
  type: (z.enum as any)(['video', 'article', 'image']),
  query: z.string().min(1),
});

const AGENT_SEARCH_REQUEST_SCHEMA = z.object({
  queries: z.array(AGENT_SEARCH_QUERY_SCHEMA).max(3),
});

const normalizeJsonText = (value: string): string => {
  let inString = false;
  let escaped = false;
  let output = '';

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      output += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      output += char;
      continue;
    }

    if (inString) {
      if (char === '\n' || char === '\r') {
        output += '\\n';
        continue;
      }
      if (char === '\t') {
        output += '\\t';
        continue;
      }
    }

    output += char;
  }

  return output;
};

const extractJsonFromOutput = (output: unknown): unknown => {
  if (!output) return output;
  if (typeof output !== 'string') return output;

  const trimmed = output.trim();
  if (!trimmed) return trimmed;

  const withoutFence = trimmed
    .replace(/^```(?: json) ?\s */i, '')
    .replace(/```$/i, '')
  .trim();

const parseWithCleanup = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return JSON.parse(normalizeJsonText(value));
  }
};

if (withoutFence.startsWith('{') || withoutFence.startsWith('[')) {
  return parseWithCleanup(withoutFence);
}

const firstBrace = withoutFence.indexOf('{');
const lastBrace = withoutFence.lastIndexOf('}');
if (firstBrace >= 0 && lastBrace > firstBrace) {
  const candidate = withoutFence.slice(firstBrace, lastBrace + 1);
  return parseWithCleanup(candidate);
}

return parseWithCleanup(withoutFence);
};

const runSearchAgentForQuery = async (
  query: AgentSearchQuery,
  modelOverride?: string | null,
): Promise<AgentSearchResult[]> => {
  ensureApiKey();
  const modelToUse = getModelForSearch(modelOverride);

  const agent = new Agent({
    name: 'WebSearchAgent',
    instructions:
      'You are a search assistant. Use the hosted web_search tool to gather relevant, specific, and interesting results for the provided query. Avoid generic or low-signal sources (stock image sites, content farms, or thin aggregator pages). Prefer high-quality sources that add depth and are likely to prompt a user reaction. Include a short excerpt in "snippet" whenever possible. For image-type queries: return only pages whose main image is contextually relevant to the topic—e.g. screenshots, icons, software UI, diagrams, or real photos of the subject. The goal is to find a page that contains a high-quality image of the subject. Do NOT return document-converter or file-conversion tool landing pages, logo/lettermark pages, or marketing pages; skip any result where the primary image would be a logo, lettermark, or tool branding. Prefer Wikipedia, official product pages, or educational articles that show the actual thing (file icon, screenshot, diagram). Return the page URL in "url"; the server will extract a real image from the page. If a search result clearly shows a direct image URL (e.g. ending in .jpg, .png), put it in "thumbnail" and "url". After you gather results, respond with JSON that matches { "results": [ { "title": string, "url": string, "snippet"?: string, "thumbnail"?: string } ] }. Limit to 5 entries, and do not include any surrounding explanation.',
    tools: [webSearchTool()],
    model: modelToUse,
  });

  const prompt = `Search Type: ${query.type}
Search Query: ${query.query}
Return ONLY the required JSON structure (no extra text). Output must be valid JSON on a single line (no code fences). Escape any newlines in snippets.`;

  const result = await run(agent, prompt);
  const output = (result as any).finalOutput;
  let parsed: unknown;

  try {
    parsed = extractJsonFromOutput(output);
  } catch (error) {
    throw new Error(
      `Search agent returned invalid JSON for "${query.query}": ${error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const validation = AGENT_SEARCH_RESPONSE_SCHEMA.safeParse(parsed);
  if (!validation.success) {
    throw new Error(
      `Search agent validation failed: ${validation.error.issues.map((issue) => issue.message).join('; ')}`
    );
  }

  return validation.data.results.map((item) => ({
    type: query.type,
    ...item,
  }));
};

export const handleAgentSearch = async (
  queries: AgentSearchQuery[],
  modelOverride?: string | null,
): Promise<AgentSearchResult[]> => {
  ensureApiKey();

  const results: AgentSearchResult[] = [];
  for (const query of queries) {
    try {
      const queryResults = await runSearchAgentForQuery(query, modelOverride);
      results.push(...queryResults);
    } catch (error) {
      console.warn('Agent search failed for query', query.query, error);
    }
  }

  return results;
};

export const parseAgentSearchRequest = (body: unknown) => {
  return AGENT_SEARCH_REQUEST_SCHEMA.safeParse(body);
};

