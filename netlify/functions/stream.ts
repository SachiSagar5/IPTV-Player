import type { Config, Context } from "@netlify/functions";

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  
  if (!target) {
    return new Response("Missing url parameter", { status: 400 });
  }

  try {
    const targetUrl = new URL(target);
    if (!["http:", "https:"].includes(targetUrl.protocol)) {
      return new Response("Invalid protocol", { status: 400 });
    }
  } catch {
    return new Response("Invalid URL", { status: 400 });
  }

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");
  headers.delete("user-agent");

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
    redirect: "follow",
  });

  const responseHeaders = new Headers(response.headers);
  
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  responseHeaders.set("Access-Control-Allow-Headers", "Range, Content-Type");
  responseHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type");
  responseHeaders.set("Access-Control-Max-Age", "86400");
  
  if (!responseHeaders.has("content-type")) {
    responseHeaders.set("Content-Type", "application/octet-stream");
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};

export const config: Config = {
  path: "/api/stream",
};