import { Agent, run } from '@openai/agents';
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
        type: z.enum(['video', 'image', 'web']),
        query: z.string().min(1),
        reason: z.string().optional(),
      }),
    )
    .max(3),
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const ensureApiKey = () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Add it to your server environment.');
  }
};

const runBasicAgent = async (instructions: string, userPrompt: string): Promise<string> => {
  ensureApiKey();

  const agent = new Agent({
    name: 'DocumentAssistant',
    instructions,
  });

  const result = await run(agent, userPrompt, {
    model: MODEL,
  });

  const output = (result as any).finalOutput;
  if (typeof output === 'string') {
    return output.trim();
  }
  return String(output ?? '').trim();
};

export const handleSummarize = async (text: string): Promise<string> => {
  const prompt = `Summarize the following text in 1–3 short sentences. Keep it concise and clear.\n\nText:\n${text.slice(
    0,
    4000,
  )}`;
  return runBasicAgent(
    'You are a concise writing assistant. Always respond with plain text only, no markdown or bullet points unless explicitly requested.',
    prompt,
  );
};

export const handleImprove = async (text: string): Promise<string> => {
  const prompt = `Improve the clarity and grammar of the following text. Preserve the original meaning and tone.\n\nReturn only the improved text, with no explanations or commentary.\n\nText:\n${text.slice(
    0,
    4000,
  )}`;
  return runBasicAgent(
    'You are a careful editor. You only return the edited text, never explanations.',
    prompt,
  );
};

export const handleExpand = async (text: string): Promise<string> => {
  const prompt = `Expand the following text into 2–4 sentences, keeping the same tone and style.\n\nReturn only the expanded text with no commentary.\n\nText:\n${text.slice(
    0,
    4000,
  )}`;
  return runBasicAgent(
    'You are a writing assistant that elaborates on ideas. You only return the expanded text.',
    prompt,
  );
};

export const handleReviewSkeletonNotes = async (text: string): Promise<string> => {
  const t = text.slice(0, 4000);

  const prompt = `You are writing "skeleton notes" for a document editor.

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

  return runBasicAgent(
    'You are a note-taking assistant that outputs ONLY JSON matching the specified TypeScript type, optionally followed by a single [SEARCH_*] tag.',
    prompt,
  );
};

export const handlePlanSearch = async (text: string): Promise<GeminiSearchPlan> => {
  ensureApiKey();

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

  const agent = new Agent({
    name: 'SearchPlanner',
    instructions:
      'You decide whether web search is useful and propose up to 3 concrete search queries. You must return strict JSON per the provided Plan type and nothing else.',
  });

  const result = await run(agent, prompt, { model: MODEL });
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

