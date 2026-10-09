/**
 * CORS proxy configuration.
 *
 * The proxy endpoint can be set at build time via VITE_CORS_PROXY env var,
 * or at runtime via the app settings (stored in localStorage).
 * Fallback is '/api/stream' for Vercel deployments.
 */
const BUILD_TIME_PROXY = (import.meta as unknown as { env: { VITE_CORS_PROXY?: string } }).env?.VITE_CORS_PROXY ?? '/api/stream';

let runtimeProxy: string | null = null;

export function getProxyEndpoint(): string {
  return runtimeProxy ?? BUILD_TIME_PROXY;
}

export function setProxyEndpoint(url: string | null): void {
  runtimeProxy = url;
}

export function shouldUseProxy(url: string): boolean {
  if (typeof window === 'undefined') return false;
  const isHttpsPage = window.location.protocol === 'https:';
  const isHttpUrl = url.startsWith('http://');
  return isHttpsPage && isHttpUrl;
}

export function buildProxyUrl(targetUrl: string): string {
  const endpoint = getProxyEndpoint();
  const encoded = encodeURIComponent(targetUrl);
  return `${endpoint}?url=${encoded}`;
}

export function getPlayableUrl(sourceUrl: string): string {
  return shouldUseProxy(sourceUrl) ? buildProxyUrl(sourceUrl) : sourceUrl;
}

/** Initialize runtime proxy from stored settings. Call once during app bootstrap. */
export function initProxyFromSettings(settings: { corsProxyUrl?: string }): void {
  if (settings.corsProxyUrl && settings.corsProxyUrl.trim()) {
    setProxyEndpoint(settings.corsProxyUrl.trim());
  } else {
    setProxyEndpoint(null);
  }
}