/**
 * Feature detection that must NOT pull hls.js into the initial bundle.
 *
 * `hlsEngine` statically imported this function, which put a 180 KB gzipped
 * dependency into the first-paint graph for users who may never press play.
 * Kept in its own module so `main.tsx` can ask the question for free.
 */
export function isNativeHlsSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const video = document.createElement('video');
  return (
    video.canPlayType('application/vnd.apple.mpegurl') !== '' ||
    video.canPlayType('application/x-mpegURL') !== ''
  );
}

/** Progressive formats a browser can hand straight to `<video>`. */
export function isProgressiveUrl(url: string): boolean {
  return /\.(mp4|m4v|webm|mov)(\?|$)/i.test(url);
}
