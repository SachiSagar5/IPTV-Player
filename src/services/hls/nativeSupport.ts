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

/**
 * HDR/Dolby/Codec feature flags detected from stream metadata.
 * Used for badges on the player UI.
 */
export interface StreamFeatures {
  hdr: 'none' | 'hdr10' | 'hdr10plus' | 'dolby-vision' | 'hlg';
  dolby: 'none' | 'dolby-atmos' | 'dolby-digital-plus' | 'dolby-digital';
  codec: 'none' | 'hevc' | 'avc' | 'vp9' | 'av1';
  resolution: 'unknown' | '480p' | '720p' | '1080p' | '1440p' | '2160p' | '4320p';
}

/**
 * Detect HDR/Dolby/codec features from HLS manifest or init segment.
 * This is a best-effort detection based on common tags and init segment parsing.
 */
export async function detectStreamFeatures(
  manifestUrl: string,
  initSegment?: Uint8Array
): Promise<StreamFeatures> {
  const features: StreamFeatures = {
    hdr: 'none',
    dolby: 'none',
    codec: 'none',
    resolution: 'unknown',
  };

  try {
    // 1. Fetch manifest and parse for HDR/Dolby tags
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (response.ok) {
      const manifest = await response.text();
      features.hdr = detectHDRFromManifest(manifest);
      features.dolby = detectDolbyFromManifest(manifest);
      features.codec = detectCodecFromManifest(manifest);
      features.resolution = detectResolutionFromManifest(manifest);
    }

    // 2. If we have an init segment, parse it for more accurate codec/HDR info
    if (initSegment) {
      const initFeatures = parseInitSegment(initSegment);
      if (initFeatures.codec !== 'none') features.codec = initFeatures.codec;
      if (initFeatures.hdr !== 'none') features.hdr = initFeatures.hdr;
      if (initFeatures.resolution !== 'unknown') features.resolution = initFeatures.resolution;
    }
  } catch {
    // Silently fail - features are best-effort
  }

  return features;
}

function detectHDRFromManifest(manifest: string): StreamFeatures['hdr'] {
  const upper = manifest.toUpperCase();

  // Dolby Vision usually signaled via EXT-X-MEDIA with TYPE=CLOSED-CAPTIONS and CHARACTERISTICS
  // or via EXT-X-SESSION-DATA with DATA-ID="urn:dvb:metadata:dv:2017"
  if (upper.includes('DOLBY-VISION') || upper.includes('DOLBYVISION') || upper.includes('DOVI')) {
    return 'dolby-vision';
  }

  // HDR10+ signaled via EXT-X-SESSION-DATA with DATA-ID="urn:dvb:metadata:hdr10plus:2018"
  if (upper.includes('HDR10PLUS') || upper.includes('HDR10+') || upper.includes('HDR10_PLUS')) {
    return 'hdr10plus';
  }

  // HLG (Hybrid Log-Gamma) often signaled in EXT-X-STREAM-INF with CHARACTERISTICS
  if (upper.includes('HLG') || upper.includes('HYBRID-LOG-GAMMA')) {
    return 'hlg';
  }

  // HDR10 - look for BT.2020 + PQ transfer characteristics in EXT-X-STREAM-INF
  // This is often in EXT-X-STREAM-INF:CHARACTERISTICS="urn:dvb:metadata:rec2020:2017,urn:dvb:metadata:pq:2017"
  if (
    upper.includes('REC2020') &&
    (upper.includes('PQ') || upper.includes('PERCEPTUAL-QUANTIZER'))
  ) {
    return 'hdr10';
  }

  // Generic HDR indicators
  if (upper.includes('HDR') && !upper.includes('SDR')) {
    // Check for BT.2020 or PQ hints
    if (upper.includes('BT2020') || upper.includes('BT.2020') || upper.includes('2020')) {
      return 'hdr10';
    }
  }

  return 'none';
}

function detectDolbyFromManifest(manifest: string): StreamFeatures['dolby'] {
  const upper = manifest.toUpperCase();

  // Dolby Atmos - look for AC-4 or Dolby Atmos markers
  if (
    upper.includes('ATMOS') ||
    upper.includes('AC-4') ||
    upper.includes('DOLBY_ATMOS')
  ) {
    return 'dolby-atmos';
  }

  // Dolby Digital Plus (E-AC-3 / EC-3)
  if (
    upper.includes('EC-3') ||
    upper.includes('EAC3') ||
    upper.includes('E-AC-3') ||
    upper.includes('DOLBY_DIGITAL_PLUS') ||
    upper.includes('DOLBY_DIGITAL+')
  ) {
    return 'dolby-digital-plus';
  }

  // Dolby Digital (AC-3)
  if (
    upper.includes('AC-3') ||
    upper.includes('DOLBY_DIGITAL') ||
    upper.includes('DOLBY AC3')
  ) {
    return 'dolby-digital';
  }

  return 'none';
}

function detectCodecFromManifest(manifest: string): StreamFeatures['codec'] {
  const upper = manifest.toUpperCase();

  // Codec is often in EXT-X-STREAM-INF:CODECS="avc1.4d401f,mp4a.40.2" or similar
  // HEVC / H.265
  if (
    upper.includes('HEVC') ||
    upper.includes('H265') ||
    upper.includes('H.265') ||
    upper.includes('HVCC') ||
    upper.includes('HVC1') ||
    upper.match(/CODECS=["']?(?:HVCC|HVC1|HEVC)/i)
  ) {
    return 'hevc';
  }

  // AV1
  if (
    upper.includes('AV1') ||
    upper.includes('AV01') ||
    upper.match(/CODECS=["']?AV01/i)
  ) {
    return 'av1';
  }

  // VP9
  if (
    upper.includes('VP9') ||
    upper.match(/CODECS=["']?VP09/i)
  ) {
    return 'vp9';
  }

  // AVC / H.264
  if (
    upper.includes('AVC') ||
    upper.includes('H264') ||
    upper.includes('H.264') ||
    upper.includes('AVC1') ||
    upper.includes('AVC3') ||
    upper.match(/CODECS=["']?AVC1/i) ||
    upper.match(/CODECS=["']?AVC3/i) ||
    upper.match(/CODECS=["']?AVC\d/i)
  ) {
    return 'avc';
  }

  return 'none';
}

function detectResolutionFromManifest(manifest: string): StreamFeatures['resolution'] {
  const upper = manifest.toUpperCase();

  // RESOLUTION=3840x2160 or RESOLUTION=3840X2160
  const resMatch = manifest.match(/RESOLUTION\s*=\s*(\d+)\s*[xX]\s*(\d+)/i);
  if (resMatch) {
    const width = parseInt(resMatch[1], 10);
    const height = parseInt(resMatch[2], 10);
    return resolutionFromDimensions(width, height);
  }

  // Fallback: look for common resolution indicators in stream names
  if (upper.includes('4320P') || upper.includes('8K')) return '4320p';
  if (upper.includes('2160P') || upper.includes('4K') || upper.includes('UHD')) return '2160p';
  if (upper.includes('1440P') || upper.includes('2K') || upper.includes('QHD')) return '1440p';
  if (upper.includes('1080P') || upper.includes('FHD') || upper.includes('FULL HD')) return '1080p';
  if (upper.includes('720P') || upper.includes('HD') || upper.includes('HIGH DEFINITION')) return '720p';
  if (upper.includes('480P') || upper.includes('SD') || upper.includes('STANDARD')) return '480p';

  return 'unknown';
}

function resolutionFromDimensions(width: number, height: number): StreamFeatures['resolution'] {
  // Use the smaller dimension for classification (handles both landscape and portrait)
  const minDim = Math.min(width, height);
  const maxDim = Math.max(width, height);

  if (minDim >= 4320 || maxDim >= 7680) return '4320p'; // 8K
  if (minDim >= 2160 || maxDim >= 3840) return '2160p'; // 4K
  if (minDim >= 1440 || maxDim >= 2560) return '1440p'; // 2K/QHD
  if (minDim >= 1080 || maxDim >= 1920) return '1080p'; // 1080p
  if (minDim >= 720 || maxDim >= 1280) return '720p'; // 720p
  if (minDim >= 480 || maxDim >= 854) return '480p'; // 480p

  return 'unknown';
}

function parseInitSegment(initSegment: Uint8Array): StreamFeatures {
  const features: StreamFeatures = {
    hdr: 'none',
    dolby: 'none',
    codec: 'none',
    resolution: 'unknown',
  };

  // Parse ISO BMFF init segment for codec and HDR info
  // Look for ftyp box and then stsd entries
  try {
    // Find all boxes
    const boxes = parseBoxes(initSegment);

    for (const box of boxes) {
      if (box.type === 'ftyp') {
        const brand = new TextDecoder().decode(box.data.subarray(0, 4));
        // Brand can indicate HEVC (hevc, hvc1, hev1) or AV1 (av01)
        if (brand === 'hevc' || brand === 'hvc1' || brand === 'hev1') {
          features.codec = 'hevc';
        } else if (brand === 'av01') {
          features.codec = 'av1';
        } else if (brand === 'vp09') {
          features.codec = 'vp9';
        } else if (brand === 'avc1' || brand === 'avc3' || brand === 'iso6' || brand === 'isom') {
          features.codec = 'avc';
        }
      }

      // Parse stsd (sample description) for detailed codec info
      if (box.type === 'moov') {
        const childBoxes = parseBoxes(box.data);
        for (const child of childBoxes) {
          if (child.type === 'trak') {
            const trakBoxes = parseBoxes(child.data);
            for (const trakBox of trakBoxes) {
              if (trakBox.type === 'mdia') {
                const mdiaBoxes = parseBoxes(trakBox.data);
                for (const mdiaBox of mdiaBoxes) {
                  if (mdiaBox.type === 'minf') {
                    const minfBoxes = parseBoxes(mdiaBox.data);
                    for (const minfBox of minfBoxes) {
                      if (minfBox.type === 'stbl') {
                        const stblBoxes = parseBoxes(minfBox.data);
                        for (const stblBox of stblBoxes) {
                          if (stblBox.type === 'stsd') {
                            const stsdBoxes = parseBoxes(stblBox.data.subarray(8)); // Skip version/flags + entry_count
                            for (const stsdBox of stsdBoxes) {
                              // Video sample entry: avc1, avc3, hvc1, hev1, vp09, av01
                              if (
                                stsdBox.type === 'avc1' ||
                                stsdBox.type === 'avc3' ||
                                stsdBox.type === 'avcC'
                              ) {
                                features.codec = 'avc';
                              } else if (
                                stsdBox.type === 'hvc1' ||
                                stsdBox.type === 'hev1' ||
                                stsdBox.type === 'hvcC'
                              ) {
                                features.codec = 'hevc';
                              } else if (stsdBox.type === 'vp09') {
                                features.codec = 'vp9';
                              } else if (stsdBox.type === 'av01') {
                                features.codec = 'av1';
                              }

                              // Parse avcC/hvcC for profile/level which can indicate HDR
                              if (stsdBox.type === 'avcC' || stsdBox.type === 'hvcC') {
                                const hdrInfo = parseCodecConfig(stsdBox.data, stsdBox.type);
                                if (hdrInfo.hdr !== 'none') features.hdr = hdrInfo.hdr;
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch {
    // Silently fail - init segment parsing is best-effort
  }

  return features;
}

function parseBoxes(data: Uint8Array): Array<{ type: string; data: Uint8Array }> {
  const boxes: Array<{ type: string; data: Uint8Array }> = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  while (offset < data.length) {
    if (offset + 8 > data.length) break;

    const size = view.getUint32(offset);
    const type = new TextDecoder().decode(data.subarray(offset + 4, offset + 8));

    if (size === 0) {
      // Box extends to end of data
      boxes.push({ type, data: data.subarray(offset + 8) });
      break;
    } else if (size === 1) {
      // 64-bit size
      if (offset + 16 > data.length) break;
      const largeSize = view.getBigUint64(offset + 8);
      if (largeSize > Number.MAX_SAFE_INTEGER) break;
      const boxData = data.subarray(offset + 16, offset + 16 + Number(largeSize) - 16);
      boxes.push({ type, data: boxData });
      offset += Number(largeSize);
    } else {
      if (offset + size > data.length) break;
      const boxData = data.subarray(offset + 8, offset + size);
      boxes.push({ type, data: boxData });
      offset += size;
    }
  }

  return boxes;
}

function parseCodecConfig(data: Uint8Array, boxType: string): { hdr: StreamFeatures['hdr'] } {
  // Parse avcC/hvcC for HDR indicators
  // This is a simplified check - real HDR detection from codec config is complex
  // and requires parsing NAL units or VPS/SPS/PPS

  // For HEVC, check if it's Main 10 profile (10-bit) which is required for HDR
  if (boxType === 'hvcC' && data.length >= 23) {
    // general_profile_space = data[1] >> 6
    // general_tier_flag = (data[1] >> 5) & 1
    // general_profile_idc = data[1] & 0x1F
    // Main 10 profile = 2 (Main 10 supports 10-bit)
    // Actually profile_idc for Main 10 is 2 in HEVC
    const generalProfileIdc = data[1] & 0x1F;
    if (generalProfileIdc === 2) {
      // Main 10 profile - could be HDR
      return { hdr: 'hdr10' };
    }
  }

  return { hdr: 'none' };
}
