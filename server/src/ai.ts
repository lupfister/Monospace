import { Agent, run, webSearchTool } from '@openai/agents';
import { z } from 'zod';

export type AiAction = 'summarize' | 'improve' | 'expand' | 'review' | 'search';

export type SearchType = 'video' | 'image' | 'web';

export type SearchPlan = {
  shouldSearch: boolean;
  queries: Array<{
    type: SearchType;
    query: string;
    reason?: string;
  }>;
};

const SEARCH_PLAN_SCHEMA = z.object({
  shouldSearch: z.boolean(),
  queries: z
    .array(
      z.object({
        type: (z.enum as any)(['web']),
        query: z.string().min(1),
        reason: z.string().optional(),
      }),
    )
    .max(10),
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

export interface ContextBlock {
  source: 'human' | 'ai';
  text: string;
}

const formatContext = (context: ContextBlock[]): string => {
  return context.map(block => `[${block.source.toUpperCase()}]: ${block.text}`).join('\n\n');
};

const getLastHumanText = (context: ContextBlock[]): string => {
  for (let i = context.length - 1; i >= 0; i--) {
    if (context[i].source === 'human') return context[i].text;
  }
  return '';
};

export const handleReviewSkeletonNotes = async (
  text: string,
  model?: string | null,
  searchContext?: string,
  context: ContextBlock[] = []
): Promise<string> => {
  // If we have structure context, use it. Otherwise fall back to raw text.
  // We prioritize the last human message for the "User's text" part, but provide the full history.
  const conversationHistory = context.length > 0 ? formatContext(context) : `[HUMAN]: ${text}`;
  const latestUserText = context.length > 0 ? getLastHumanText(context) : text;

  const prompt = `You are writing "skeleton notes" for a document editor. The app will display content in this order: (1) Viewed Sources, (2) Text quote excerpts from sources, (3) your questions.
  
You are receiving a CONVERSATION HISTORY between a Human and AI.
Your goal is to RESPOND to the LATEST Human input, while respecting the context of the previous turn.

Output MUST be valid JSON only (no markdown, no code fences, no commentary) matching this TypeScript type:
type Block =
  | { kind: "ai"; text: string } // DEPRECATED: Do NOT use this block. The app handles content display via quotes.
  | { kind: "input"; prompt: string; lines: number };
type Output = { blocks: Block[] };

Output order (strict):
1. Questions: 1–3 "input" blocks. 
   - Base your questions primarily on the *content* of the search results (which will be displayed as quotes to the user).
   - If the search results focus on a single clear fact/concept, ask questions about that specific detail.
   - If the results are diverse or contradictory, ask about the collective implications or the tension between them.
   - Questions should be thought-provoking but directly relevant to the material found.
   - Use "input" blocks: prompt is shown in gray; then render exactly "lines" empty user lines to fill in (use 2–4 for depth).

Rules:
- Do NOT output any "ai" blocks (information sections).
- Do NOT output any text that says "Video link:", "Image link:", or raw URLs.
- Do NOT add a "Summary" section.
- Do NOT include any markdown links (e.g. [text](url)) in the output text.
- If the user's text asks a question, assume the search results (quotes) provide the answer. Ask a follow-up question that bridges that answer to the user's broader intent.
- Keep total blocks <= 5 (just the questions).

After the JSON, if you think further web search results would be helpful (unlikely since we just searched), append ONE tag on a new line (outside JSON):
- [SEARCH_ARTICLES: query]
- [SEARCH_ALL: query]
Only add a tag if deeper research is needed.`;

  const finalPrompt = `${prompt}

${searchContext ? `Context from web search (incorporate relevant findings into the information section where helpful, but do not explicitly cite "search results"):
${searchContext}` : ''
    }

CONVERSATION HISTORY:
${conversationHistory}

LATEST USER INPUT (Focus your response here):
${latestUserText} `;

  return runBasicAgent(
    'You are a note-taking assistant that outputs ONLY JSON matching the specified TypeScript type, optionally followed by a single [SEARCH_*] tag.',
    finalPrompt,
    model,
  );
};

export const handlePlanSearch = async (
  text: string,
  model?: string | null,
  context: ContextBlock[] = []
): Promise<SearchPlan> => {
  ensureApiKey();
  // Use same model as search so plan quality matches execution (nano doesn't support web search; plan with mini).
  const modelToUse = getModelForSearch(model);

  const conversationHistory = context.length > 0 ? formatContext(context) : `[HUMAN]: ${text}`;
  const latestUserText = context.length > 0 ? getLastHumanText(context) : text;

  const prompt = `You are an Expert Search Strategist. Your goal is to find content that connects the user's text to unexpected fields, history, or future possibilities. Avoid the obvious.

Analyze the user's text and craft strategic queries. Use as few queries as needed to get high-quality results (typically 2-5).

Return ONLY valid JSON:
type Plan = {
  shouldSearch: boolean;
  queries: Array<{ type: "web"; query: string; reason?: string }>;
};

GOALS BY TYPE:
• WEB (Article): Find primary sources, surprising research findings, or in-depth analysis from reputable institutions. Look for content that provides substantive context and "rabbit holes" to explore.

Text to analyze:
${conversationHistory}

Focus on the LATEST human input:
${latestUserText}`;

  const agent = new Agent({
    name: 'SearchPlanner',
    instructions:
      'You are a proactive research assistant. You default to searching (shouldSearch: true) unless the request is trivial or purely creative writing. You must return strict JSON per the provided Plan type and nothing else.',
    model: modelToUse,
  });

  const result = await run(agent, prompt);
  const output = (result as any).finalOutput;
  const raw = typeof output === 'string' ? output.trim() : String(output ?? '').trim();
  console.log('[SearchPlanner] Raw output:', raw);

  try {
    const parsed = extractJsonFromOutput(raw);
    const validated = SEARCH_PLAN_SCHEMA.safeParse(parsed);
    if (!validated.success) {
      return { shouldSearch: false, queries: [] };
    }
    return validated.data;
  } catch (e) {
    console.error('[SearchPlanner] Error:', e);
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
  queries: z.array(AGENT_SEARCH_QUERY_SCHEMA).max(10),
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

  // Aggressively strip markdown code fences
  const withoutFence = trimmed
    .replace(/^```[a-zA-Z]*\n?/i, '') // Remove starting fence (```json, ```, etc) + optional newline
    .replace(/```$/i, '') // Remove ending fence
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
      'You are an Expert Research Agent. Your goal is to find high-signal, interesting, and authoritative content to embed in a professional document.\n\n' +
      'FOR IMAGES:\n' +
      '• Target diagrams, infographics, historical photos, or technical screenshots.\n' +
      '• Avoid generic icons, logos, or stock photos.\n' +
      '• Find pages where the primary image is contextually rich.\n\n' +
      'FOR VIDEOS:\n' +
      '• Target educational content, experts, or primary demonstrations.\n' +
      '• Ensure the source is reputable (universities, experts, official channels).\n\n' +
      'FOR ARTICLES (WEB):\n' +
      '• Target primary sources or surprising expert findings.\n' +
      '• EXTRACT A DIRECT QUOTE: For the "snippet", copy 1-2 interesting sentences directly from the source. Do NOT summarize.\n\n' +
      'OUTPUT:\n' +
      'Return JSON: { "results": [ { "title": string, "url": string, "snippet"?: string, "thumbnail"?: string } ] }\n' +
      'Limit to 5 results.',
    tools: [webSearchTool()],
    model: modelToUse,
  });

  const prompt = `Search Type: ${query.type}
Search Query: ${query.query}
Return ONLY the required JSON structure (no extra text). Output must be valid JSON on a single line (no code fences). Escape any newlines in snippets. Ensure you call the web_search tool to get real results first.`;

  try {
    const result = await run(agent, prompt);
    const output = (result as any).finalOutput;
    console.log(`[SearchAgent] Raw output for "${query.query}":`, output);

    let parsed: unknown;
    try {
      parsed = extractJsonFromOutput(output);
    } catch (error) {
      console.error(`[SearchAgent] JSON parse failed for "${query.query}":`, output);
      // Fallback: try to see if the agent returned a string that looks like an error
      throw new Error(
        `Search agent returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const validation = AGENT_SEARCH_RESPONSE_SCHEMA.safeParse(parsed);
    if (!validation.success) {
      console.error(`[SearchAgent] Schema validation failed for "${query.query}":`, validation.error);
      throw new Error(
        `Search agent validation failed: ${validation.error.issues.map((issue) => issue.message).join('; ')}`
      );
    }

    return validation.data.results.map((item) => ({
      type: query.type,
      ...item,
    }));
  } catch (err) {
    console.error(`[SearchAgent] run failed for "${query.query}":`, err);
    throw err;
  }
};

export const handleExploreSource = async (
  url: string,
  model?: string | null,
  previousContext?: string,
): Promise<string> => {
  ensureApiKey();
  const modelToUse = getModelForSearch(model);

  const agent = new Agent({
    name: 'SourceExplorer',
    instructions:
      'You are a researcher providing deep, surprising, or highly specific facts from a source. ' +
      'STRICT: State the fact DIRECTLY. Do NOT attribute it (no "The authors show...", "The study says...", "According to the article..."). ' +
      'BAD: "The study demonstrates that cats sleep 18 hours." ' +
      'GOOD: "Cats sleep 18 hours a day, utilizing a unique REM cycle." ' +
      'STRICT: Provide ONLY a direct, interesting technical or historical fact found within or about the source. ' +
      'STRICT: If previous context is provided, you MUST find a completely different, new, and deeper detail. ' +
      'MAX LENGTH: 45 words. 2 sentences maximum. ' +
      'STRICT NO LINKS: Never include URLs, markdown links, or domain names. ' +
      'Output ONLY the fact text. No preamble.',
    tools: [webSearchTool()],
    model: modelToUse,
  });

  const prompt = `Source: ${url}
${previousContext ? `KNOWN INFO: "${previousContext}". TASK: Find a NEW, deeper, and unrelated surprising fact about this source. State it directly without "The study says".` : 'TASK: Find one surprising or deeply specific technical/historical fact from this source (2 sentences). State it directly without "The study says".'}
Output ONLY the fact text.`;

  const result = await run(agent, prompt);
  let output = typeof result === 'string' ? result : String((result as any).finalOutput ?? '').trim();

  // POST-PROCESS: Aggressively strip any links/URLs that slipped through
  output = output
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Clean [label](url) -> label
    .replace(/https?:\/\/[^\s]+/g, '')        // Remove raw URLs
    .replace(/\s+/g, ' ')                      // Normalize spaces
    .trim();

  // Cap length by sentences if still too long
  const sentences = output.split(/[.!?]+\s/).filter(s => s.length > 5);
  if (sentences.length > 2) {
    output = sentences.slice(0, 2).join('. ') + '.';
  }

  return output;
};

export const handleAgentSearch = async (
  queries: AgentSearchQuery[],
  modelOverride?: string | null,
): Promise<AgentSearchResult[]> => {
  ensureApiKey();

  // Execute all searches in parallel for speed
  const searchPromises = queries.map(query =>
    runSearchAgentForQuery(query, modelOverride)
      .catch(error => {
        console.warn('[handleAgentSearch] Query failed:', query.query, error);
        return []; // Return empty on failure, don't break other queries
      })
  );

  const allResults = await Promise.all(searchPromises);
  return allResults.flat();
};

export const parseAgentSearchRequest = (body: unknown) => {
  return AGENT_SEARCH_REQUEST_SCHEMA.safeParse(body);
};

// Skeleton Notes types
export type SkeletonNoteBlock =
  | { kind: 'ai'; text: string }
  | { kind: 'input'; prompt: string; lines: number };

export interface SkeletonNotes {
  blocks: SkeletonNoteBlock[];
  searchTag?: string;
}

// Parse skeleton notes from AI response
export const parseSkeletonNotes = (text: string): SkeletonNotes => {
  const jsonEndIndex = text.lastIndexOf('}') + 1;
  const jsonPart = text.slice(0, jsonEndIndex).trim();
  const tagPart = text.slice(jsonEndIndex).trim();

  try {
    const parsed = JSON.parse(jsonPart) as { blocks: SkeletonNoteBlock[] };
    return {
      blocks: parsed.blocks || [],
      searchTag: tagPart || undefined,
    };
  } catch (e) {
    console.error('[parseSkeletonNotes] Failed to parse JSON:', e, 'Raw:', text);
    return { blocks: [] };
  }
};

// Unified review handler - does planning, search, and narrative in one call
export interface FullReviewResult {
  plan: SearchPlan;
  searchResults: AgentSearchResult[];
  narrative: SkeletonNotes;
}

export const handleFullReview = async (
  text: string,
  model?: string | null,
  context?: ContextBlock[]
): Promise<FullReviewResult> => {
  // 1. Plan search
  console.log('[handleFullReview] Starting plan phase...');
  const validContext = context || [];
  const plan = await handlePlanSearch(text, model, validContext);
  console.log('[handleFullReview] Plan:', plan);

  // 2. Execute searches in parallel (if needed)
  let searchResults: AgentSearchResult[] = [];
  if (plan.shouldSearch && plan.queries.length > 0) {
    console.log('[handleFullReview] Executing', plan.queries.length, 'searches in parallel...');
    // Map SearchType to AgentSearchResultType ('web' -> 'article')
    const agentQueries: AgentSearchQuery[] = plan.queries.map(q => ({
      type: q.type === 'web' ? 'article' : q.type,
      query: q.query,
      reason: q.reason,
    }));
    searchResults = await handleAgentSearch(agentQueries, model);
    console.log('[handleFullReview] Got', searchResults.length, 'search results');
  }

  // 3. Generate narrative with search context
  const searchContext = searchResults.length > 0
    ? searchResults.map(r => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet || ''}`).join('\n\n')
    : undefined;

  console.log('[handleFullReview] Generating narrative...');
  const narrativeText = await handleReviewSkeletonNotes(text, model, searchContext, validContext);
  const narrative = parseSkeletonNotes(narrativeText);
  console.log('[handleFullReview] Generated', narrative.blocks.length, 'blocks');

  return { plan, searchResults, narrative };
};

