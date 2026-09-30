import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomBytes } from 'crypto';
import { buildAuthUrl, exchangeCodeForTokens, generatePKCE } from '@/services/trakt/client';

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
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

const STATE_STORE = new Map<string, { verifier: string; redirectTo: string; expires: number }>();

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [key, value] of STATE_STORE.entries()) {
    if (value.expires < now) STATE_STORE.delete(key);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin ?? null;
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }

  const clientId = process.env.TRAKT_CLIENT_ID;
  const redirectUri = process.env.TRAKT_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).json({ error: 'Trakt not configured' });
  }

  // GET /api/trakt/auth?redirectTo=/player/123
  if (req.method === 'GET') {
    cleanupExpiredStates();

    const { verifier, challenge } = generatePKCE();
    const state = randomBytes(16).toString('hex');
    const redirectTo = (req.query.redirectTo as string) ?? '/';

    STATE_STORE.set(state, {
      verifier,
      redirectTo,
      expires: Date.now() + 10 * 60 * 1000, // 10 min
    });

    const authUrl = buildAuthUrl(clientId, redirectUri, challenge, state);
    return res.redirect(authUrl);
  }

  // POST /api/trakt/auth (code exchange)
  if (req.method === 'POST') {
    const { code, state } = req.body as { code?: string; state?: string };

    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state' });
    }

    const stored = STATE_STORE.get(state);
    if (!stored || stored.expires < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired state' });
    }
    STATE_STORE.delete(state);

    try {
      const tokens = await exchangeCodeForTokens(
        clientId,
        process.env.TRAKT_CLIENT_SECRET!,
        code,
        redirectUri,
        stored.verifier
      );

      // Return tokens to client (they'll store in IndexedDB)
      return res.status(200).json({ tokens, redirectTo: stored.redirectTo });
    } catch (error) {
      console.error('Token exchange failed:', error);
      return res.status(500).json({ error: 'Failed to exchange code' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}