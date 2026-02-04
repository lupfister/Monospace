import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import {
  handleAgentSearch,
  handleExpand,
  handleImprove,
  handlePlanSearch,
  handleReviewSkeletonNotes,
  handleSummarize,
  parseAgentSearchRequest,
} from './ai';

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

type AiAction = 'summarize' | 'improve' | 'expand' | 'review' | 'plan_search';

interface AiRequestBody {
  action: AiAction;
  text: string;
  model?: string | null;
}

app.post('/api/ai/action', async (req: any, res: any) => {
  const { action, text, model } = req.body || {};

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

    if (action === 'improve') {
      const resultText = await handleImprove(text, model);
      return res.json({ ok: true, text: resultText });
    }

    if (action === 'expand') {
      const resultText = await handleExpand(text, model);
      return res.json({ ok: true, text: resultText });
    }

    if (action === 'review') {
      const resultText = await handleReviewSkeletonNotes(text, model);
      return res.json({ ok: true, text: resultText });
    }

    if (action === 'plan_search') {
      const plan = await handlePlanSearch(text, model);
      return res.json({ ok: true, plan });
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
  const urls: string[] = [];
  const seen = new Set<string>();
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = absolutize(m[1], baseUrl);
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
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

