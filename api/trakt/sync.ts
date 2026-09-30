import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createTraktClient } from '@/services/trakt/client';

const ALLOWED_ORIGINS = [
  'https://iptvplayer-ebon.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin ?? null;
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  const accessToken = authHeader.slice(7);
  const client = createTraktClient({ access_token: accessToken } as any);

  try {
    // GET /api/trakt/sync/watched
    if (req.method === 'GET' && req.url?.includes('/watched')) {
      const [shows, movies] = await Promise.all([
        client.getWatchedShows().catch(() => []),
        client.getWatchedMovies().catch(() => []),
      ]);
      return res.status(200).json({ shows, movies });
    }

    // GET /api/trakt/sync/history
    if (req.method === 'GET' && req.url?.includes('/history')) {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const after = req.query.after as string | undefined;
      const history = await client.getHistory({ limit, after });
      return res.status(200).json({ history });
    }

    // GET /api/trakt/sync/recommendations
    if (req.method === 'GET' && req.url?.includes('/recommendations')) {
      const type = (req.query.type as 'shows' | 'movies') ?? 'shows';
      const recs = await client.getRecommendations(type);
      return res.status(200).json({ recommendations: recs });
    }

    // POST /api/trakt/sync/history (add to history)
    if (req.method === 'POST' && req.url?.includes('/history')) {
      const result = await client.addToHistory(req.body);
      return res.status(200).json(result);
    }

    // POST /api/trakt/sync/history/remove
    if (req.method === 'POST' && req.url?.includes('/history/remove')) {
      const result = await client.removeFromHistory(req.body);
      return res.status(200).json(result);
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('Trakt sync error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Sync failed' });
  }
}