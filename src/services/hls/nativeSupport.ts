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
  return PROGRESSIVE_EXT.test(url);
}

const PROGRESSIVE_EXT = /\.(mp4|m4v|webm|mov|ogv|ogg)(\?|#|$)/i;

const HLS_EXT = /\.m3u8?(\?|#|$)/i;

/**
 * Containers VLC opens and no browser will.
 *
 * Matroska and AVI have no demuxer in Chrome, Firefox or Safari, and raw
 * MPEG-TS needs one too. IPTV lists routinely ship Matroska files *named* `.ts`,
 * so the extension is the only signal available without downloading the file to
 * sniff its magic bytes. A false positive costs the user a clear error message
 * instead of a 25-second hls.js timeout; a false negative costs a confusing one.
 */
const UNPLAYABLE_LABELS: Record<string, string> = {
  mkv: 'Matroska (.mkv)',
  mka: 'Matroska audio (.mka)',
  avi: 'AVI',
  divx: 'DivX',
  flv: 'Flash Video (.flv)',
  f4v: 'Flash Video (.f4v)',
  wmv: 'Windows Media (.wmv)',
  asf: 'Windows Media (.asf)',
  rm: 'RealMedia (.rm)',
  rmvb: 'RealMedia (.rmvb)',
  ts: 'MPEG transport stream (.ts)',
  m2ts: 'MPEG transport stream (.m2ts)',
  mts: 'MPEG transport stream (.mts)',
  mpg: 'MPEG (.mpg)',
  mpeg: 'MPEG (.mpeg)',
  mpe: 'MPEG (.mpe)',
  dat: 'MPEG program stream (.dat)',
  vob: 'DVD VOB (.vob)',
  iso: 'DVD ISO (.iso)',
  '3gp': '3GP',
  qt: 'QuickTime (.qt)',
  mxf: 'MXF',
};

/**
 * What the URL says the stream is, which is what decides the engine.
 *
 * Getting this wrong is expensive in both directions: sending a playable MP4
 * through hls.js produces a manifest-parse error for a file the browser would
 * have played, and handing a Matroska file to `<video>` produces a silent
 * black frame.
 */
export type StreamShape =
  | { kind: 'progressive' }
  | { kind: 'hls' }
  | { kind: 'unsupported'; label: string; ext: string }
  /** No usable extension — assume HLS, which is what most IPTV lists use. */
  | { kind: 'unknown' };

function extensionOf(url: string): string {
  // Ignore the query and fragment: providers append signed tokens to every URL,
  // and `?file=movie.mkv` must not be mistaken for an HLS manifest.
  const path = url.split(/[?#]/, 1)[0] ?? url;
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  const dot = lastSegment.lastIndexOf('.');
  if (dot <= 0) return '';
  return lastSegment.slice(dot + 1).toLowerCase();
}

export function classifyStream(url: string): StreamShape {
  const ext = extensionOf(url);
  if (!ext) return { kind: 'unknown' };
  if (HLS_EXT.test(url)) return { kind: 'hls' };
  if (PROGRESSIVE_EXT.test(url)) return { kind: 'progressive' };
  const label = UNPLAYABLE_LABELS[ext];
  if (label) return { kind: 'unsupported', label, ext };
  return { kind: 'unknown' };
}
