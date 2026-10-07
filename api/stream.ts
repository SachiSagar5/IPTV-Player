import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_ORIGINS = [
  'https://iptvplayer-ebon.vercel.app',
  'https://iptvplayer-9xf08hngx-sachisagar5s-projects.vercel.app',
  'https://iptvplayer-at63nnqea-sachisagar5s-projects.vercel.app',
  'https://iptvplayer-65y3p251z-sachisagar5s-projects.vercel.app',
  'https://iptvplayer-4dun1y3h4-sachisagar5s-projects.vercel.app',
  'https://iptvplayer-fv2mq2zg8-sachisagar5s-projects.vercel.app',
  'https://iptvplayer-au81efopb-sachisagar5s-projects.vercel.app',
  'https://iptvplayer-1ret0ol7t-sachisagar5s-projects.vercel.app',
  'https://iptvplayer-oiifz1s82-sachisagar5s-projects.vercel.app',
  'https://iptvplayer-eligywxf6-sachisagar5s-projects.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

function corsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app') || origin.startsWith('http://localhost:'));
  const allowOrigin = isAllowed ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin ?? null;
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin ?? null;
    const optsHeaders = corsHeaders(origin);
    res.setHeader('Access-Control-Allow-Origin', optsHeaders['Access-Control-Allow-Origin']);
    res.setHeader('Access-Control-Allow-Methods', optsHeaders['Access-Control-Allow-Methods']);
    res.setHeader('Access-Control-Allow-Headers', optsHeaders['Access-Control-Allow-Headers']);
    res.setHeader('Access-Control-Max-Age', optsHeaders['Access-Control-Max-Age']);
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const targetUrl = req.query.url as string | undefined;
  if (!targetUrl || !isSafeUrl(targetUrl)) {
    return res.status(400).json({ error: 'Invalid or missing url parameter' });
  }

  const rangeHeader = req.headers.range as string | undefined;
  const fetchHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (compatible; IPTVProxy/1.0)',
    Accept: '*/*',
  };
  if (rangeHeader) fetchHeaders.Range = rangeHeader;

  try {
    const upstream = await fetch(targetUrl, {
      headers: fetchHeaders,
      redirect: 'follow',
    });

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({ error: `Upstream error: ${upstream.status}` });
    }

    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    const acceptRanges = upstream.headers.get('accept-ranges');
    const cacheControl = upstream.headers.get('cache-control');

    res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
    if (cacheControl) res.setHeader('Cache-Control', cacheControl);
    else res.setHeader('Cache-Control', 'public, max-age=3600');

    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

    if (req.method === 'HEAD') {
      return res.status(upstream.status).end();
    }

    if (!upstream.body) {
      return res.status(502).json({ error: 'No response body from upstream' });
    }

    const reader = upstream.body.getReader();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        } finally {
          reader.releaseLock();
        }
      },
      cancel() {
        reader.cancel().catch(() => undefined);
      },
    });

    return new Response(stream, {
      status: upstream.status,
      headers: Object.fromEntries(res.getHeaders()),
    });
  } catch (error) {
    console.error('Stream proxy error:', error);
    return res.status(502).json({ error: 'Failed to fetch upstream stream' });
  }
}

export const config = {
  api: {
    responseLimit: false,
    externalResolver: true,
  },
};