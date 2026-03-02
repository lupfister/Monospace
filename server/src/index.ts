import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import {
  handleAgentSearch,
  handleExpand,
  handleExploreSource,
  type FullReviewResult,
  handleFullReview,
  handleImprove,
  handleLastUserSentence,
  handlePlanSearch,
  handleReviewSkeletonNotes,
  handleSummarize,
  handleTitle,
  parseAgentSearchRequest,
} from './ai';

const app = express();
const PORT = Number(process.env.PORT || 4000);

const REVIEW_REQUEST_CACHE_TTL_MS = 10 * 60 * 1000;
const REVIEW_REQUEST_PENDING_TTL_MS = 2 * 60 * 1000;

type ReviewRequestCacheEntry =
  | {
    status: 'pending';
    startedAt: number;
    promise: Promise<FullReviewResult>;
  }
  | {
    status: 'fulfilled';
    startedAt: number;
    completedAt: number;
    result: FullReviewResult;
  };

const reviewRequestCache = new Map<string, ReviewRequestCacheEntry>();

const pruneReviewRequestCache = () => {
  const now = Date.now();
  for (const [key, entry] of reviewRequestCache.entries()) {
    if (entry.status === 'pending') {
      if (now - entry.startedAt > REVIEW_REQUEST_PENDING_TTL_MS) {
        reviewRequestCache.delete(key);
      }
      continue;
    }
    if (now - entry.completedAt > REVIEW_REQUEST_CACHE_TTL_MS) {
      reviewRequestCache.delete(key);
    }
  }
};

app.use(cors());
app.use(express.json({ limit: '1mb' }));

type AiAction = 'summarize' | 'improve' | 'expand' | 'review' | 'plan_search' | 'explore_source' | 'title' | 'last_user_sentence';

interface AiRequestBody {
  action: AiAction;
  text: string;
  model?: string | null;
}

app.post('/api/ai/action', async (req: any, res: any) => {
  const { action, text, model, context } = req.body || {};
  console.log(`[API] /action request: ${action}, text len: ${text?.length}, model: ${model}, context len: ${context?.length}`);

  if (!action || typeof action !== 'string') {
    return res.status(400).json({ ok: false, error: 'Missing or invalid "action" field.' });
  }

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ ok: false, error: 'Missing or invalid "text" field.' });
  }

  try {
    if (action === 'summarize') {
      const resultText = await handleSummarize(text, model);
      return res.json({ ok: true, text: resultText });
    }

    if (action === 'title') {
      const resultText = await handleTitle(text, model);
      return res.json({ ok: true, text: resultText });
    }

    if (action === 'improve') {
      const resultText = await handleImprove(text, model);
      return res.json({ ok: true, text: resultText });
    }

    if (action === 'expand') {
      const resultText = await handleExpand(text, model);
      return res.json({ ok: true, text: resultText });
    }

    if (action === 'last_user_sentence') {
      const resultText = await handleLastUserSentence(text, model);
      return res.json({ ok: true, text: resultText });
    }

    if (action === 'review') {
      const searchContext = (req.body as any).searchContext;
      const resultText = await handleReviewSkeletonNotes(text, model, searchContext, context);
      return res.json({ ok: true, text: resultText });
    }

    if (action === 'plan_search') {
      const plan = await handlePlanSearch(text, model, context);
      return res.json({ ok: true, plan });
    }

    if (action === 'explore_source') {
      // For explore_source, 'text' is the URL
      const previousContext = (req.body as any).previousContext;
      const resultText = await handleExploreSource(text, model, previousContext);
      return res.json({ ok: true, text: resultText });
    }

    return res.status(400).json({ ok: false, error: `Unsupported action: ${action}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('AI action error:', message);
    return res.status(500).json({ ok: false, error: message });
  }
});

app.post('/api/ai/search', async (req: any, res: any) => {
  const parsed = parseAgentSearchRequest(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Invalid search queries.' });
  }

  const model = (req.body as { model?: string | null })?.model;

  try {
    const results = await handleAgentSearch(parsed.data.queries, model);
    return res.json({ ok: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Agent search error:', message);
    return res.status(500).json({ ok: false, error: message });
  }
});

// Error classification helper
function classifyError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('rate limit') || message.includes('429')) return 'rate_limit';
  if (message.includes('network') || message.includes('fetch')) return 'network';
  if (message.includes('content policy') || message.includes('safety')) return 'content_policy';
  if (message.includes('aborted') || message.includes('cancel')) return 'cancelled';
  return 'unknown';
}

// Unified review endpoint - batches planning, search, and narrative into one call
app.post('/api/ai/review', async (req: any, res: any) => {
  const { text, model, context, requestKey } = req.body || {};
  const normalizedRequestKey = typeof requestKey === 'string' && requestKey.trim()
    ? requestKey.trim().slice(0, 256)
    : undefined;
  console.log(
    `[API] /review request: text len: ${text?.length}, model: ${model}, context len: ${context?.length}, key: ${normalizedRequestKey ?? 'none'}`
  );

  if (!text || typeof text !== 'string') {
    return res.status(400).json({
      ok: false,
      error: { type: 'validation', message: 'Missing or invalid "text" field.' }
    });
  }

  try {
    pruneReviewRequestCache();

    if (normalizedRequestKey) {
      const existing = reviewRequestCache.get(normalizedRequestKey);
      if (existing) {
        if (existing.status === 'fulfilled') {
          return res.json({ ok: true, ...existing.result });
        }

        const pendingResult = await existing.promise;
        return res.json({ ok: true, ...pendingResult });
      }
    }

    const startedAt = Date.now();
    const runPromise = handleFullReview(text, model, context);
    if (normalizedRequestKey) {
      reviewRequestCache.set(normalizedRequestKey, {
        status: 'pending',
        startedAt,
        promise: runPromise,
      });
    }

    const result = await runPromise;
    if (normalizedRequestKey) {
      reviewRequestCache.set(normalizedRequestKey, {
        status: 'fulfilled',
        startedAt,
        completedAt: Date.now(),
        result,
      });
    }

    return res.json({ ok: true, ...result });
  } catch (error) {
    if (normalizedRequestKey) {
      reviewRequestCache.delete(normalizedRequestKey);
    }
    const message = error instanceof Error ? error.message : String(error);
    const errorType = classifyError(error);
    console.error('[/api/ai/review] Error:', errorType, message);
    return res.status(500).json({
      ok: false,
      error: { type: errorType, message }
    });
  }
});

const IMAGE_PROXY_MAX_HTML = 300_000;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg)(\?|$)/i;

const absolutize = (raw: string, baseUrl: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return null;
  }
};

const extractOgImageFromHtml = (html: string, baseUrl: string): string | null => {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const raw = match?.[1]?.trim();
    if (!raw) continue;
    const url = absolutize(raw, baseUrl);
    if (url) return url;
  }
  return null;
};

/** Extract direct image URLs from <img src="..."> in HTML. Prefer URLs that look like content images. */
const extractImgSrcsFromHtml = (html: string, baseUrl: string): string[] => {
  const candidates: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>();
  const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    const url = absolutize(m[1], baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const imgTag = m[0];
    let score = 0;

    // Extract width/height if available
    const widthMatch = imgTag.match(/width=["']?(\d+)/i);
    const heightMatch = imgTag.match(/height=["']?(\d+)/i);
    const width = widthMatch ? parseInt(widthMatch[1]) : 0;
    const height = heightMatch ? parseInt(heightMatch[1]) : 0;

    // Size scoring (larger images are usually content, not UI elements)
    if (width >= 600 || height >= 400) score += 20;
    else if (width >= 300 || height >= 200) score += 10;
    else if (width > 0 && width < 100 && height > 0 && height < 100) score -= 15; // Likely icon/logo

    // URL pattern scoring
    const urlLower = url.toLowerCase();

    // Positive signals
    if (/upload|content|media|article|post|image|photo|picture/i.test(urlLower)) score += 15;
    if (/\d{3,4}x\d{3,4}|large|full|original|hd/i.test(urlLower)) score += 12;
    if (/wikimedia|wikipedia/i.test(urlLower)) score += 10;

    // Negative signals (UI elements, not content)
    if (/logo|icon|favicon|sprite|button|badge|avatar|thumbnail/i.test(urlLower)) score -= 25;
    if (/ad|banner|promo|sponsor/i.test(urlLower)) score -= 20;
    if (/\.svg/i.test(urlLower)) score -= 10; // SVGs often logos/icons
    if (/pixel|tracking|analytics|1x1/i.test(urlLower)) score -= 30;

    // Class/alt scoring from img tag
    if (/class=["'][^"']*(?:hero|featured|main|article|content)[^"']*["']/i.test(imgTag)) score += 15;
    if (/class=["'][^"']*(?:logo|icon|nav|header|footer)[^"']*["']/i.test(imgTag)) score -= 15;

    candidates.push({ url, score });
  }

  // Sort by score (highest first) and return URLs
  return candidates
    .sort((a, b) => b.score - a.score)
    .map(c => c.url);
};

/** Resolve to the first URL that returns an actual image (Content-Type image/*). */
const resolveToImageUrl = async (
  candidates: string[],
  headers: Record<string, string>,
): Promise<string | null> => {
  for (const url of candidates.slice(0, 15)) {
    try {
      const res = await fetch(url, { method: 'HEAD', headers });
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.startsWith('image/')) return url;
    } catch {
      continue;
    }
  }
  return null;
};

app.get('/api/ai/image', async (req: any, res: any) => {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!rawUrl) {
    return res.status(400).json({ ok: false, error: 'Missing url parameter.' });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid url parameter.' });
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return res.status(400).json({ ok: false, error: 'Unsupported protocol.' });
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'image/*,*/*;q=0.8',
      },
    });

    if (!upstream.ok) {
      return res.status(502).json({ ok: false, error: `Upstream error: ${upstream.status}` });
    }

    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('text/html')) {
      const html = await upstream.text();
      const base = target.href;
      const fetchHeaders = {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'image/*,*/*;q=0.8',
      };

      let imageUrl: string | null = extractOgImageFromHtml(html.slice(0, IMAGE_PROXY_MAX_HTML), base);
      if (imageUrl) {
        try {
          const head = await fetch(imageUrl, { method: 'HEAD', headers: fetchHeaders });
          if (!head.ok || !(head.headers.get('content-type') || '').toLowerCase().startsWith('image/')) {
            imageUrl = null;
          }
        } catch {
          imageUrl = null;
        }
      }

      if (!imageUrl) {
        const imgSrcs = extractImgSrcsFromHtml(html.slice(0, IMAGE_PROXY_MAX_HTML), base);
        const withExt = imgSrcs.filter((u) => IMAGE_EXT.test(u));
        const candidates = withExt.length > 0 ? withExt : imgSrcs;
        imageUrl = await resolveToImageUrl(candidates, fetchHeaders);
      }

      if (!imageUrl) {
        return res.status(404).json({ ok: false, error: 'No image found on page (og:image or <img>).' });
      }

      const imageRes = await fetch(imageUrl, { headers: fetchHeaders });
      if (!imageRes.ok) {
        return res.status(502).json({ ok: false, error: `Image fetch failed: ${imageRes.status}` });
      }
      const imgContentType = imageRes.headers.get('content-type') || 'application/octet-stream';
      res.setHeader('Content-Type', imgContentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const arrayBuffer = await imageRes.arrayBuffer();
      return res.status(200).send(Buffer.from(arrayBuffer));
    }

    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const arrayBuffer = await upstream.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return res.status(200).send(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ ok: false, error: message });
  }
});

app.use((err: Error, _req: any, res: any, _next: any) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, error: 'Internal server error.' });
});

export default app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AI server listening on http://localhost:${PORT}`);
  });
}
