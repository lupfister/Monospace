import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import {
  handleExpand,
  handleImprove,
  handlePlanSearch,
  handleReviewSkeletonNotes,
  handleSummarize,
} from './ai';

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

type AiAction = 'summarize' | 'improve' | 'expand' | 'review' | 'plan_search';

interface AiRequestBody {
  action: AiAction;
  text: string;
}

app.post('/api/ai/action', async (req: Request<unknown, unknown, AiRequestBody>, res: Response) => {
  const { action, text } = req.body || {};

  if (!action || typeof action !== 'string') {
    return res.status(400).json({ ok: false, error: 'Missing or invalid "action" field.' });
  }

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ ok: false, error: 'Missing or invalid "text" field.' });
  }

  try {
    if (action === 'summarize') {
      const resultText = await handleSummarize(text);
      return res.json({ ok: true, text: resultText });
    }

    if (action === 'improve') {
      const resultText = await handleImprove(text);
      return res.json({ ok: true, text: resultText });
    }

    if (action === 'expand') {
      const resultText = await handleExpand(text);
      return res.json({ ok: true, text: resultText });
    }

    if (action === 'review') {
      const resultText = await handleReviewSkeletonNotes(text);
      return res.json({ ok: true, text: resultText });
    }

    if (action === 'plan_search') {
      const plan = await handlePlanSearch(text);
      return res.json({ ok: true, plan });
    }

    return res.status(400).json({ ok: false, error: `Unsupported action: ${action}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('AI action error:', message);
    return res.status(500).json({ ok: false, error: message });
  }
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`AI server listening on http://localhost:${PORT}`);
});

