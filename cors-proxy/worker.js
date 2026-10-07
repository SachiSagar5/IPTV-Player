export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    
    if (!target) {
      return new Response('Missing url parameter', { status: 400 });
    }

    try {
      const targetUrl = new URL(target);
      
      // Only allow http/https
      if (!['http:', 'https:'].includes(targetUrl.protocol)) {
        return new Response('Invalid protocol', { status: 400 });
      }
    } catch {
      return new Response('Invalid URL', { status: 400 });
    }

    const headers = new Headers(request.headers);
    // Remove headers that browsers don't allow to be set
    headers.delete('host');
    headers.delete('origin');
    headers.delete('referer');
    headers.delete('user-agent');

    // Handle Range requests for video seeking
    const range = headers.get('range');
    
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      redirect: 'follow',
    });

    const responseHeaders = new Headers(response.headers);
    
    // Add CORS headers
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Range, Content-Type');
    responseHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
    responseHeaders.set('Access-Control-Max-Age', '86400');
    
    // Ensure content-type is preserved
    if (!responseHeaders.has('content-type')) {
      responseHeaders.set('Content-Type', 'application/octet-stream');
    }

    // Handle OPTIONS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: responseHeaders,
      });
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  }
};