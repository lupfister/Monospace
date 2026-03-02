import { Agent, run, webSearchTool } from '@openai/agents';
import { z } from 'zod';

export type AiAction = 'summarize' | 'improve' | 'expand' | 'review' | 'search' | 'title' | 'last_user_sentence';

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

const QUERY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'if', 'in', 'into', 'is', 'it', 'its',
  'of', 'on', 'or', 'that', 'the', 'their', 'them', 'there', 'these', 'this', 'to', 'was', 'we', 'what', 'when',
  'where', 'which', 'who', 'why', 'with', 'you', 'your',
]);

const SUMMARY_STYLE_SNIPPET_PATTERNS = [
  /^(this|the|a|an)\s+(video|article|page|paper|study|site|website|research|report|post|piece|guide|blog|analysis)\b/i,
  /^(this|it)\s+(covers?|discusses?|explains?|describes?|explores?|examines?|analyzes?|reviews?|presents?|shows?|demonstrates?|provides?|offers?|outlines?|details?|focuses?)\b/i,
  /^(the\s+author|authors?|researcher|researchers?|writer|study|research|article|paper)\s+(cover|discuss|explain|describe|explore|examine|analyze|review|present|show|demonstrate|provide|offer|outline|detail|focus)\b/i,
  /^(here|in this|according to)\b/i,
  /^(an?\s+)?(overview|summary|introduction|explanation|description|analysis)\s+(of|to)\b/i,
];

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const cleanSearchSnippet = (value: string): string => {
  let cleaned = value;
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  cleaned = cleaned.replace(/https?:\/\/[^\s)]+/g, '');
  cleaned = cleaned.replace(/\s*\(?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\)?\.?$/g, '');
  cleaned = cleaned.replace(/\s*(?:Source|Via):.*$/i, '');
  cleaned = normalizeWhitespace(cleaned);
  cleaned = cleaned.replace(/^["“”'`]+/, '').replace(/["“”'`]+$/, '');
  return normalizeWhitespace(cleaned);
};

const isSummaryStyleSnippet = (snippet: string): boolean =>
  SUMMARY_STYLE_SNIPPET_PATTERNS.some((pattern) => pattern.test(snippet));

const isSnippetViable = (snippet: string): boolean => {
  const len = snippet.length;
  if (len < 45 || len > 380) return false;
  if (isSummaryStyleSnippet(snippet)) return false;
  if (!/[a-z]/i.test(snippet)) return false;
  return true;
};

const extractKeywordTokens = (text: string): string[] => {
  const normalized = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ');

  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const token of normalized.split(/\s+/)) {
    if (!token || token.length < 3) continue;
    if (QUERY_STOP_WORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length >= 12) break;
  }
  return tokens;
};

const buildFallbackSearchQuery = (latestUserText: string): string => {
  const tokens = extractKeywordTokens(latestUserText);
  if (tokens.length === 0) return normalizeWhitespace(latestUserText).slice(0, 160);
  return tokens.slice(0, 8).join(' ');
};

const buildRetrySearchQuery = (latestUserText: string): string => {
  const tokens = extractKeywordTokens(latestUserText);
  if (tokens.length === 0) return 'latest analysis primary sources';
  const base = tokens.slice(0, 6).join(' ');
  return normalizeWhitespace(`${base} evidence mechanism case study latest`).slice(0, 180);
};

const normalizePlannedQuery = (query: string, latestUserText: string): string => {
  let cleaned = normalizeWhitespace(query);
  cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '');
  cleaned = cleaned.replace(/^search\s+(for|about)\s+/i, '');
  cleaned = cleaned.replace(/[?]+$/g, '');
  cleaned = normalizeWhitespace(cleaned);
  if (cleaned.length > 180) cleaned = cleaned.slice(0, 180).trim();

  const tokenCount = extractKeywordTokens(cleaned).length;
  if (tokenCount < 3 || cleaned.length < 16) {
    return buildFallbackSearchQuery(latestUserText);
  }
  return cleaned;
};

const getUrlDedupKey = (rawUrl: string): string => {
  const FALLBACK = rawUrl.trim().toLowerCase();
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach((param) => {
      url.searchParams.delete(param);
    });
    const sorted = Array.from(url.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.protocol}//${url.hostname.toLowerCase()}${path}${sorted ? `?${sorted}` : ''}`;
  } catch {
    return FALLBACK;
  }
};

const SHORT_QUESTION_SOFT_MAX = 95;
const SHORT_QUESTION_HARD_MAX = 120;
const SHORT_QUESTION_TARGET_WORDS = 20;
const SHORT_QUESTION_HARD_WORDS = 24;
const SHORT_QUESTION_MAX_SENTENCES = 2;
const SHORT_QUESTION_MAX_WORDS_PER_SENTENCE = 14;

const toWords = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

const capWords = (text: string, maxWords: number): string => {
  const words = toWords(text);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(' ').trim();
};

const splitRunOnSegment = (segment: string): string[] => {
  const normalized = segment.trim();
  if (!normalized) return [];
  const words = toWords(normalized);
  if (words.length <= SHORT_QUESTION_MAX_WORDS_PER_SENTENCE) return [normalized];

  const markers = [' and ', ' but ', ' so ', ' because ', ' while ', ' whereas ', ', ', '; '];
  let bestCut = -1;
  for (const marker of markers) {
    const idx = normalized.toLowerCase().indexOf(marker);
    if (idx <= 0) continue;
    const leftWords = toWords(normalized.slice(0, idx)).length;
    if (leftWords >= 7 && leftWords <= 14) {
      bestCut = idx + marker.length;
      break;
    }
  }

  if (bestCut > 0) {
    const left = normalized.slice(0, bestCut).replace(/[,:;\s]+$/g, '').trim();
    const right = normalized.slice(bestCut).replace(/^[,:;\s]+/g, '').trim();
    const parts = [left, right].filter(Boolean);
    if (parts.length > 1) return parts;
  }

  const halfwayWords = Math.min(
    SHORT_QUESTION_MAX_WORDS_PER_SENTENCE,
    Math.max(8, Math.floor(words.length / 2))
  );
  return [words.slice(0, halfwayWords).join(' '), words.slice(halfwayWords).join(' ')].filter(Boolean);
};

const shortenQuestionPrompt = (value: string): string => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return normalized;

  const rawSentences = normalized
    .replace(/[;]+/g, '.')
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const compactSentences: string[] = [];
  for (const sentence of rawSentences) {
    const segments = splitRunOnSegment(sentence);
    for (const segment of segments) {
      const capped = capWords(segment, SHORT_QUESTION_MAX_WORDS_PER_SENTENCE);
      if (capped) compactSentences.push(capped);
      if (compactSentences.length >= SHORT_QUESTION_MAX_SENTENCES) break;
    }
    if (compactSentences.length >= SHORT_QUESTION_MAX_SENTENCES) break;
  }

  if (compactSentences.length === 0) {
    compactSentences.push(capWords(normalized, SHORT_QUESTION_TARGET_WORDS));
  }

  let candidate = compactSentences.join(' ').trim();
  candidate = capWords(candidate, SHORT_QUESTION_HARD_WORDS);

  if (toWords(candidate).length > SHORT_QUESTION_TARGET_WORDS && compactSentences.length > 1) {
    const firstOnly = capWords(compactSentences[0], SHORT_QUESTION_TARGET_WORDS);
    if (firstOnly) candidate = firstOnly;
  }

  if (candidate.length <= SHORT_QUESTION_SOFT_MAX) {
    if (!/[.!?]$/.test(candidate)) candidate += '?';
    return candidate;
  }

  let clipped = candidate.slice(0, SHORT_QUESTION_HARD_MAX);
  const lastSpace = clipped.lastIndexOf(' ');
  if (lastSpace > 60) clipped = clipped.slice(0, lastSpace);
  clipped = clipped.replace(/[,:;\-]\s*$/g, '').trim();
  if (!/[.!?]$/.test(clipped)) clipped += '?';
  return clipped;
};

const normalizeQuestionPrompt = (value: string): string =>
  shortenQuestionPrompt(normalizeWhitespace(value).replace(/^[\-\d).\s]+/, '').trim());

const normalizeSkeletonBlocks = (rawBlocks: unknown): SkeletonNoteBlock[] => {
  if (!Array.isArray(rawBlocks)) return [];

  const out: SkeletonNoteBlock[] = [];
  const seenPrompts = new Set<string>();

  for (const block of rawBlocks) {
    if (!block || typeof block !== 'object') continue;
    const kind = (block as any).kind;
    if (kind !== 'input') continue;

    const rawPrompt = typeof (block as any).prompt === 'string' ? (block as any).prompt : '';
    const prompt = normalizeQuestionPrompt(rawPrompt);
    if (!prompt) continue;

    const promptKey = prompt.toLowerCase();
    if (seenPrompts.has(promptKey)) continue;
    seenPrompts.add(promptKey);

    const lines = 2;
    out.push({ kind: 'input', prompt, lines });

    if (out.length >= 3) break;
  }

  return out;
};

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';

export const AI_MODELS = [
  { id: 'gpt-5-nano', label: 'Nano', description: 'Lowest cost' },
  { id: 'gpt-5-mini', label: 'Mini', description: 'Cost-efficient' },
  { id: 'gpt-5', label: 'GPT-5', description: 'Balanced' },
  { id: 'gpt-5.1', label: 'GPT-5.1', description: 'Faster GPT-5' },
  { id: 'gpt-5.2', label: 'GPT-5.2', description: 'Latest GPT-5' },
  { id: 'gpt-5.2-pro', label: 'GPT-5.2 Pro', description: 'Highest quality' },
] as const;

const getModel = (model?: string | null): string => {
  if (model && typeof model === 'string' && model.trim()) return model.trim();
  return DEFAULT_MODEL;
};

/** gpt-4.1-nano does not support web_search; use mini for search when nano is requested. */
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

export const handleTitle = async (text: string, model?: string | null): Promise<string> => {
  const prompt = `Create a short, descriptive title (2–6 words) based on the text below. Use Title Case. Return only the title.\n\nText:\n${text.slice(
    0,
    2000,
  )}`;
  return runBasicAgent(
    'You generate concise document titles. Return only the title text with no quotes or punctuation.',
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

export const handleLastUserSentence = async (text: string, model?: string | null): Promise<string> => {
  const prompt = `Return the last complete sentence from the user-written text below.\n\nRules:\n- If the final thought is a fragment or list item, return that last fragment as-is.\n- Do NOT combine multiple list items or sentences.\n- Return a single line with no quotes or markdown.\n- Keep it under 160 characters when possible.\n\nText:\n${text.slice(0, 4000)}`;
  return runBasicAgent(
    'You extract the final user-written sentence or fragment. Return only the text, no labels.',
    prompt,
    model,
  );
};

export interface ContextBlock {
  source: 'human' | 'ai';
  text: string;
  updatedAt?: number;
  highlighted?: boolean;
}

const CONTEXT_WEIGHTING = {
  humanBase: 1.25,
  aiBase: 0.8,
  highlightedBoost: 1.6,
  recencyHalfLifeMinutes: 60 * 24 * 3, // 3 days
  recencyBoostMax: 0.9,
  priorityBlockLimit: 10,
  priorityCharLimit: 3200,
  fullContextCharLimit: 14000,
  fullContextHeadRatio: 0.25,
} as const;

const normalizeTimestamp = (raw?: number | string | null): number | undefined => {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const num = Number(raw);
    if (!Number.isNaN(num) && num > 0) return num;
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
};

const scoreContextBlock = (block: ContextBlock, nowMs: number): number => {
  const base = block.source === 'human' ? CONTEXT_WEIGHTING.humanBase : CONTEXT_WEIGHTING.aiBase;
  const highlightBoost = block.highlighted ? CONTEXT_WEIGHTING.highlightedBoost : 1;
  const updatedAt = normalizeTimestamp(block.updatedAt);
  const halfLifeMs = CONTEXT_WEIGHTING.recencyHalfLifeMinutes * 60 * 1000;
  let recencyBoost = 0;
  if (updatedAt && updatedAt <= nowMs) {
    const ageMs = nowMs - updatedAt;
    recencyBoost = Math.exp(-ageMs / halfLifeMs);
  }
  return base * highlightBoost * (1 + CONTEXT_WEIGHTING.recencyBoostMax * recencyBoost);
};

const formatContextBlock = (
  block: ContextBlock,
  opts: { includeMeta: boolean; score?: number },
): string => {
  const labelParts = [block.source.toUpperCase()];
  if (opts.includeMeta && block.highlighted) labelParts.push('HIGHLIGHTED');
  if (opts.includeMeta) {
    const updatedAt = normalizeTimestamp(block.updatedAt);
    if (updatedAt) labelParts.push(`UPDATED ${new Date(updatedAt).toISOString()}`);
    if (typeof opts.score === 'number') labelParts.push(`WEIGHT ${opts.score.toFixed(2)}`);
  }
  return `[${labelParts.join(' | ')}]: ${block.text}`;
};

const buildFullContext = (blocks: Array<{ formatted: string }>): string => {
  const joined = blocks.map(b => b.formatted).join('\n\n');
  if (joined.length <= CONTEXT_WEIGHTING.fullContextCharLimit) return joined;

  const headBudget = Math.round(CONTEXT_WEIGHTING.fullContextCharLimit * CONTEXT_WEIGHTING.fullContextHeadRatio);
  const tailBudget = CONTEXT_WEIGHTING.fullContextCharLimit - headBudget - 40;

  let head = '';
  for (const block of blocks) {
    const next = head ? `${head}\n\n${block.formatted}` : block.formatted;
    if (next.length > headBudget) break;
    head = next;
  }

  let tail = '';
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const next = tail ? `${blocks[i].formatted}\n\n${tail}` : blocks[i].formatted;
    if (next.length > tailBudget) break;
    tail = next;
  }

  return `${head}\n\n[...truncated for length...]\n\n${tail}`.trim();
};

const buildWeightedContext = (context: ContextBlock[]) => {
  const nowMs = Date.now();
  const scored = context.map((block, index) => {
    const updatedAt = normalizeTimestamp(block.updatedAt);
    return {
      block: { ...block, updatedAt },
      index,
      score: scoreContextBlock(block, nowMs),
    };
  });

  const prioritySorted = [...scored].sort((a, b) => b.score - a.score);
  const priorityBlocks: typeof scored = [];
  let priorityChars = 0;
  for (const item of prioritySorted) {
    if (priorityBlocks.length >= CONTEXT_WEIGHTING.priorityBlockLimit) break;
    const formatted = formatContextBlock(item.block, { includeMeta: true, score: item.score });
    if (priorityChars + formatted.length > CONTEXT_WEIGHTING.priorityCharLimit && priorityBlocks.length > 0) break;
    priorityBlocks.push({ ...item, formatted });
    priorityChars += formatted.length + 2;
  }

  const priorityContext = priorityBlocks
    .map(item => item.formatted ?? formatContextBlock(item.block, { includeMeta: true, score: item.score }))
    .join('\n\n');

  const fullContext = buildFullContext(
    scored.map(item => ({
      formatted: formatContextBlock(item.block, { includeMeta: false }),
    })),
  );

  return { priorityContext, fullContext };
};

const getLastHumanText = (context: ContextBlock[]): string => {
  let lastInOrder: ContextBlock | null = null;
  let latestByTime: { block: ContextBlock; ts: number } | null = null;

  for (const block of context) {
    if (block.source !== 'human') continue;
    lastInOrder = block;
    const ts = normalizeTimestamp(block.updatedAt);
    if (ts && (!latestByTime || ts > latestByTime.ts)) {
      latestByTime = { block, ts };
    }
  }

  if (latestByTime) return latestByTime.block.text;
  return lastInOrder?.text || '';
};

export const handleReviewSkeletonNotes = async (
  text: string,
  model?: string | null,
  searchContext?: string,
  context: ContextBlock[] = []
): Promise<string> => {
  // If we have structure context, use it. Otherwise fall back to raw text.
  // We prioritize the last human message for the "User's text" part, but provide the full history.
  const hasContext = context.length > 0;
  const weighted = hasContext ? buildWeightedContext(context) : null;
  const conversationHistory = hasContext ? weighted!.fullContext : `[HUMAN]: ${text}`;
  const priorityContext = hasContext ? weighted!.priorityContext : '';
  const latestUserText = hasContext ? getLastHumanText(context) : text;

  const prompt = `You are writing "skeleton notes" for a document editor. The app will display content in this order: (1) Viewed Sources, (2) Text quote excerpts from sources, (3) your questions.
  
You are receiving a CONVERSATION HISTORY between a Human and AI.
Your goal is to RESPOND to the LATEST Human input, while respecting the context of the previous turn.

Core persona:
- Act like the user's thinking partner that helps ideas keep moving between sessions (implicit "extended mind").
- Questions should scaffold future thinking when the user returns to the note.
- Prioritize self-learning: what the user understands, believes, assumes, is unsure about, or wants to test.
- Keep it curious and practical. Avoid therapeutic, academic, poetic, or performative tone.
- Match the user's writing style and energy level (simple when they are brief; deeper when they are detailed).

Output MUST be valid JSON only (no markdown, no code fences, no commentary) matching this TypeScript type:
type Block =
  | { kind: "ai"; text: string } // DEPRECATED: Do NOT use this block. The app handles content display via quotes.
  | { kind: "input"; prompt: string; lines: number };
type Output = { blocks: Block[] };

Output order (strict):
1. Questions: 1–3 "input" blocks.
   - Questions should be short and manageable.
   - Strong grounding rule: if a question references specific facts/concepts, they MUST come from the excerpted snippets.
   - It is also acceptable to ask broader metacognitive questions inspired by the overall excerpt set ("the vibe"), without naming unseen sources.
   - Focus on interpretation, understanding, implications, assumptions, or personal viewpoint.
   - Ask in a low-pressure, jot-friendly way. Make it easy to answer quickly.
   - Avoid quiz/trivia framing and avoid factual recall tests.
   - Keep wording plain and natural; avoid academic jargon.
   - Keep prompts brief and skimmable (usually ~8-18 words; target ~20 words max).
   - Avoid run-on phrasing and long multi-clause questions.
   - One longer sentence or two short sentences are both fine when concise.
   - Aim for <= 110 chars; only exceed when needed, and keep it under ~120 chars.
   - Use "input" blocks: \`lines\` must be exactly 2.
   - Vary depth by context through wording/content (not line count): shallow + concrete for short user text, deeper + synthesis for richer user text.
   - Prefer bite-sized prompts, with occasional deeper follow-up.
   - No duplicate or near-duplicate questions.

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

${searchContext ? `Context from web search (use these snippets to ground question specificity):
${searchContext}` : ''
    }

PRIORITY CONTEXT (use this first; weighted toward user-written text, highlighted AI text, and most recent timestamps):
${priorityContext || 'None'}

FULL CONTEXT (chronological, may be truncated for length):
${conversationHistory}

LATEST USER INPUT (Focus your response here):
${latestUserText} `;

  return runBasicAgent(
    'You are a reflective note scaffolding assistant. Output ONLY valid JSON matching the specified TypeScript type, optionally followed by a single [SEARCH_*] tag.',
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

  const hasContext = context.length > 0;
  const weighted = hasContext ? buildWeightedContext(context) : null;
  const conversationHistory = hasContext ? weighted!.fullContext : `[HUMAN]: ${text}`;
  const priorityContext = hasContext ? weighted!.priorityContext : '';
  const latestUserText = hasContext ? getLastHumanText(context) : text;
  const todayIso = new Date().toISOString().slice(0, 10);

  const prompt = `You are an Expert Search Strategist. Generate one high-signal web query that helps produce useful reflective prompts for the user's latest note.

Today: ${todayIso}

Analyze the context and craft exactly one query only when search is needed.

Return ONLY valid JSON:
type Plan = {
  shouldSearch: boolean;
  queries: Array<{ type: "web"; query: string; reason?: string }>;
};

Query quality requirements:
- Query should be specific and information-dense (target ~8-16 words).
- Include concrete anchor terms from the latest user text (proper nouns, topic terms, domain terms).
- Add one disambiguator when possible: timeframe, region, methodology, mechanism, or named entity.
- Prefer terms likely to appear in authoritative article titles.
- Avoid vague meta phrasing ("learn about", "interesting facts", "overview").
- If user asks for current/latest status, include a recent year or "latest".
- Do not use natural-language questions; output a search-ready phrase.
- Favor sources likely to contain concrete claims, tensions, mechanisms, case studies, or counterpoints.
- Optimize for sources that can trigger self-understanding questions, not just generic definitions.

Text to analyze:
${conversationHistory}

Priority context (weighted toward user-written text, highlighted AI text, and most recent timestamps):
${priorityContext || 'None'}

Focus on the LATEST human input:
${latestUserText}`;

  const agent = new Agent({
    name: 'SearchPlanner',
    instructions:
      'You are a proactive research assistant. Default to shouldSearch: true unless the request is trivial or purely creative writing. Return strict JSON matching Plan and nothing else. Your query should support reflective, user-centered follow-up questions.',
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

    const clampedQueries = validated.data.queries
      .slice(0, 1)
      .map((query) => ({
        ...query,
        query: normalizePlannedQuery(query.query, latestUserText),
      }))
      .filter((query) => query.query.length > 0);

    if (validated.data.shouldSearch && clampedQueries.length === 0) {
      const fallbackQuery = buildFallbackSearchQuery(latestUserText);
      if (!fallbackQuery) return { shouldSearch: false, queries: [] };
      return {
        shouldSearch: true,
        queries: [{ type: 'web', query: fallbackQuery }],
      };
    }

    return {
      shouldSearch: validated.data.shouldSearch,
      queries: clampedQueries,
    };
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
      'You are an Expert Research Agent. Your goal is to find high-signal, interesting, and authoritative content to embed in a document.\n\n' +
      'FOR IMAGES:\n' +
      '• Target diagrams, infographics, historical photos, or technical screenshots.\n' +
      '• Avoid generic icons, logos, or stock photos.\n' +
      '• Find pages where the primary image is contextually rich.\n\n' +
      'FOR VIDEOS:\n' +
      '• Target educational content, experts, or primary demonstrations.\n' +
      '• Ensure the source is reputable (universities, experts, official channels).\n\n' +
      'FOR ARTICLES (WEB):\n' +
      '• Target primary sources or surprising expert findings.\n' +
      '• Prefer official, or technically credible sources over generic SEO blogs.\n' +
      '• Prefer excerpts with concrete claims, tensions, mechanisms, tradeoffs, or examples that can spark reflective questions.\n' +
      '• EXTRACT A DIRECT QUOTE: For "snippet", copy 1-2 verbatim source sentences (not a summary).\n' +
      '• Snippet quality: concrete claim/detail, 45-300 chars, no URL text, no "this article explains..." phrasing.\n\n' +
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

    const deduped: AgentSearchResult[] = [];
    const seenUrls = new Set<string>();
    const seenSnippets = new Set<string>();

    for (const item of validation.data.results) {
      const title = normalizeWhitespace(item.title);
      const url = normalizeWhitespace(item.url);
      if (!title || !url) continue;

      const urlKey = getUrlDedupKey(url);
      if (seenUrls.has(urlKey)) continue;

      const cleanedSnippet = item.snippet ? cleanSearchSnippet(item.snippet) : undefined;
      let snippet: string | undefined;
      if (cleanedSnippet && isSnippetViable(cleanedSnippet)) {
        snippet = cleanedSnippet;
      } else if (cleanedSnippet && cleanedSnippet.length >= 25) {
        // Relaxed fallback so excerpt rendering can still work when quote quality is imperfect.
        snippet = cleanedSnippet.slice(0, 380).trim();
      }
      const snippetKey = snippet ? snippet.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() : '';

      if (snippetKey && seenSnippets.has(snippetKey)) continue;

      seenUrls.add(urlKey);
      if (snippetKey) seenSnippets.add(snippetKey);

      deduped.push({
        type: query.type,
        title,
        url,
        snippet,
        thumbnail: item.thumbnail ? normalizeWhitespace(item.thumbnail) : undefined,
      });
    }

    return deduped.slice(0, 5);
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
      'STRICT: Provide ONLY a direct, interesting fact found within or about the source. ' +
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
    const normalizedBlocks = normalizeSkeletonBlocks(parsed.blocks);
    return {
      blocks: normalizedBlocks,
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
  const latestUserText = validContext.length > 0 ? getLastHumanText(validContext) : text;
  const primaryFallbackQuery = buildFallbackSearchQuery(latestUserText) || buildFallbackSearchQuery(text) || 'latest analysis';

  // 2. Execute searches (always attempt at least one query)
  let searchResults: AgentSearchResult[] = [];
  const plannedQueries: AgentSearchQuery[] = plan.queries.map(q => ({
    type: q.type === 'web' ? 'article' : q.type,
    query: q.query,
    reason: q.reason,
  }));
  const agentQueries: AgentSearchQuery[] = plannedQueries.length > 0
    ? plannedQueries
    : [{ type: 'article', query: primaryFallbackQuery, reason: 'fallback_always_search' }];

  console.log('[handleFullReview] Executing', agentQueries.length, 'searches...');
  searchResults = await handleAgentSearch(agentQueries, model);

  if (searchResults.length === 0) {
    const retryQuery = buildRetrySearchQuery(latestUserText);
    const retryAgentQuery: AgentSearchQuery = { type: 'article', query: retryQuery, reason: 'fallback_retry_search' };
    const sameAsPrimary = agentQueries.some((q) => q.query.toLowerCase() === retryQuery.toLowerCase());
    if (!sameAsPrimary) {
      console.log('[handleFullReview] Primary search empty; retrying with broader fallback query...');
      searchResults = await handleAgentSearch([retryAgentQuery], model);
    }
  }

  if (searchResults.length === 0) {
    // Final fallback keeps sources/excerpts section non-empty even if upstream search fails.
    const fallbackUrl = `https://www.google.com/search?q=${encodeURIComponent(primaryFallbackQuery)}`;
    searchResults = [{
      type: 'article',
      title: `Fallback source: ${primaryFallbackQuery}`,
      url: fallbackUrl,
      snippet: 'Search results were unavailable. Open this source and clip one concrete line into your note.',
    }];
  }
  console.log('[handleFullReview] Got', searchResults.length, 'search results');

  // 3. Generate narrative with search context
  const searchContext = searchResults.length > 0
    ? searchResults.map(r => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet || ''}`).join('\n\n')
    : undefined;

  console.log('[handleFullReview] Generating narrative...');
  const narrativeText = await handleReviewSkeletonNotes(text, model, searchContext, validContext);
  const narrative = parseSkeletonNotes(narrativeText);
  if (narrative.blocks.length === 0) {
    narrative.blocks = [{
      kind: 'input',
      prompt: searchResults.length > 0
        ? 'What idea here feels most worth carrying forward the next time you return, and why?'
        : 'What part of your thinking feels least settled right now, and what would clarify it next?',
      lines: 2,
    }];
  }
  console.log('[handleFullReview] Generated', narrative.blocks.length, 'blocks');

  return { plan, searchResults, narrative };
};
