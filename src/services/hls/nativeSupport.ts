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

/**
 * Refuses streams the browser will never load, before a single request goes out.
 *
 * A page over https cannot fetch plain-http media: that is the mixed-content
 * rule, applied by every browser before CORS and before codecs. It is the most
 * common way an IPTV stream "hangs in buffering" — the request is quietly
 * rejected and the element idles. The rule is not app-side, so the only honest
 * response is to refuse fast with the real reason instead of a spinner.
 *
 * The native shell is excluded deliberately: Capacitor's WebView enforces its
 * own mixed-content policy and ships with cleartext already allowed, so what is
 * a hard wall for a browser page is the running app's normal business.
 */
export function isBlockedByMixedContent(url: string): boolean {
  if (typeof window === 'undefined') return false;
  if ('Capacitor' in window) return false;
  if (window.location.protocol !== 'https:') return false;
  try {
    return new URL(url, window.location.href).protocol === 'http:';
  } catch {
    return false;
  }
}

/** What the served bytes and response headers say a stream actually is. */
export type SniffedShape =
  | 'matroska'
  | 'mp4'
  | 'webm'
  | 'mov'
  | 'ogg'
  | 'flv'
  | 'avi'
  | 'wmv'
  | 'mpeg'
  | 'ts'
  | 'hls'
  | 'unknown';

/**
 * Judge a stream from its first bytes and `Content-Type`, not its URL.
 *
 * Used when the URL gives nothing to classify on: providers hand extension-less
 * ids like `/movie/264901` that resolve (via redirect) to a container the
 * browser cannot open. Without this, those files were sent to hls.js as if HLS
 * and spun through manifest retries — the "stuck in buffering" this module
 * exists to prevent. Magic bytes matter more than the header: a lot of panels
 * label everything `application/octet-stream`.
 */
export function sniffStreamShape(head: Uint8Array, contentType: string): SniffedShape {
  const ct = contentType.toLowerCase();
  const bytes = head;
  const has = (prefix: number[]): boolean =>
    bytes.length >= prefix.length && prefix.every((b, index) => bytes[index] === b);

  // EBML opens WebM and Matroska alike; the two live in the same container spec.
  // Content-Type is what tells them apart, defaulting to Matroska — in IPTV
  // lists a `.webm` is a collector's item but `.mkv` is the daily reality.
  if (has([0x1a, 0x45, 0xdf, 0xa3])) {
    return ct.includes('webm') ? 'webm' : 'matroska';
  }
  // ISO BMFF: an `ftyp` box lives at offset 4 of MP4, M4V and MOV files. Only
  // the brand bytes are checked — the box size before them varies.
  if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return ct.includes('quicktime') ? 'mov' : 'mp4';
  }
  if (has([0x4f, 0x67, 0x67, 0x53])) return 'ogg';
  if (has([0x46, 0x4c, 0x56, 0x01])) return 'flv';
  if (has([0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x41 && bytes[9] === 0x56 && bytes[10] === 0x49) return 'avi';
  if (
    has([
      0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce,
      0x6c,
    ])
  ) return 'wmv';
  if (has([0x00, 0x00, 0x01, 0xba])) return 'mpeg';
  // MPEG-TS packets reopen with a 0x47 sync byte every 188 bytes.
  if (bytes.length >= 189 && bytes[0] === 0x47 && bytes[188] === 0x47) return 'ts';

  // A silent header is unusual; a *wrong* one is common, so the bytes above
  // decide and the header only fills in when there are no bytes to look at.
  if (ct.includes('matroska') || ct.includes('/mkv')) return 'matroska';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('mpegurl')) return 'hls';
  // `video/mp2t` is what a *manifests* claim half the time; only mark raw TS
  // when the sync bytes are actually there, never on the header alone.
  if (ct.includes('mp4') || ct.includes('m4v')) return 'mp4';
  if (ct.includes('quicktime')) return 'mov';
  if (ct.includes('ogg')) return 'ogg';
  if (ct.includes('flv')) return 'flv';
  if (ct.includes('msvideo') || ct.includes('x-msvideo') || ct.includes('/avi')) return 'avi';
  if (ct.includes('x-ms-wmv') || ct.includes('asf')) return 'wmv';
  return 'unknown';
}
