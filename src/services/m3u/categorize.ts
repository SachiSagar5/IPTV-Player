/**
 * Content classification.
 *
 * IPTV providers have wildly different conventions — some use `group-title`
 * reliably, some put everything in one group and rely on the title, some use
 * Xtream-style prefixes (`|EU|`, `US:` …). The strategy is therefore a scored
 * vote across several signals, and anything below the confidence threshold is
 * deliberately classified as `other` rather than guessed at.
 */
import type { ContentKind } from '@/types';

export interface ClassifyInput {
  name: string;
  group: string;
  tvgId: string;
  attrs: Record<string, string>;
  hasVodMarker: boolean;
  /**
   * The primary stream URL. Optional, and the single most reliable signal
   * available: providers put live channels in `.ts`/`.m3u8` paths and movies in
   * `.mp4`/`.mkv` paths, and they do this consistently even when `group-title`
   * is useless. See `CONTAINER_KIND`.
   */
  streamUrl?: string;
}

/**
 * Content-type words in `group-title`.
 *
 * Deliberately excludes `hd`/`sd`/`fhd`/`4k`/`uhd`. Those describe *quality*,
 * not content type, and they appear on live groups constantly — matching them
 * as VOD is what made "News HD" classify as a movie and fill the Movies page
 * with news channels.
 */
const VOD_GROUP =
  /\b(vod|movie|movies|film|films|cinema|new\s*release|latest|top\s*\d*|popular|adult|18\+|pay\s*per\s*view|ppv|box\s*office)\b/i;

/** Unambiguous live categories. `entertainment`/`drama` are intentionally absent. */
const LIVE_GROUP =
  /\b(news|sports?|music|kids?|children|documentary|religio\w*|cooking|travel|lifestyle|business|weather|local|regional|outdoor|nature|anime\s*tv|classic\s*tv|cartoon)\b/i;

const SERIES_GROUP =
  /\b(series|serials?|tv\s*shows?|show\s*series|season|seasons|web\s*series|episode|episodes)\b/i;

/**
 * File extension -> content type, from the stream path.
 *
 * This outranks group names because it is set by the provider's own packaging
 * rather than by a human naming a folder.
 *
 *  - A progressive container is a movie essentially always.
 *  - A single transport stream is a live channel essentially always.
 *  - `.m3u8` is deliberately **decisive for neither**: VOD is increasingly served
 *    over HLS, so treating a playlist URL as proof of a live channel would
 *    misclassify every modern VOD catalogue.
 */
const CONTAINER_VOD = /\.(mp4|m4v|mkv|avi|mov|wmv|flv|divx)\b/i;
const CONTAINER_LIVE = /\.(ts|mpegts)\b/i;

/** Prefixes used by Xtream-style providers to tag language/region. */
const PREFIX_TAG = /^[\s|]*(us|uk|ca|au|in|pk|bd|lk|np|sa|ae|qa|kw|om|eg|za|ng|ke|de|fr|es|it|nl|be|pt|ru|tr|ar|br|mx|pl|cz|sk|hu|ro|gr|jp|kr|cn|th|my|ph|vn|id|my|ir|iq|jo|il|sg|hk|tw|ch|at|se|no|fi|dk|il|eu|arabic|hindi|kannada|tamil|telugu|malayalam|marathi|bengali|gujarati|punjabi|urdu|english)\b\s*[:|\-–]\s*/i;

const MOVIE_NAME_HINT = /\b(movie|film|blu.?ray|bdrip|webrip|web.?dl|hdrip|dvdrip|dual\s*audio|hindi\s*dubbed?|dubbed)\b/i;

const SERIES_EPISODE_HINT = /\b(s\d{1,2}\s*e\d{1,3}|season\s*\d{1,2}|episode\s*\d{1,3}|\d{1,2}x\d{2})\b/i;

/**
 * Content-type words in the entry's own name.
 *
 * A trailing quality tag ("1080p", "HD", "4K") is deliberately *not* treated as
 * evidence here, even though `VOD_GROUP` already refuses to treat one as
 * evidence of being a movie. Providers append a quality tag to essentially
 * every title they sell, so scoring it as a live signal meant a film named
 * "Dune 1080p" outscored a genuine channel: `live` reached `STRONG` outright
 * and the whole catalogue was filed under Live TV. Content words *are*
 * evidence, so "Sports HD" still reads as live while "Dune 1080p" does not.
 */
const LIVE_NAME_CONTENT =
  /\b(news|sports?|music|kids?|children|documentar\w*|religio\w*|cooking|travel|lifestyle|business|weather|local|regional|outdoor|nature|cartoon|channel|entertainment|variety)\b/i;

/** Score for one direction (movies/series) using group + name signals. */
function scoreGroup(group: string): { movie: number; series: number; live: number } {
  const g = group.trim();
  if (!g) return { movie: 0, series: 0, live: 0 };
  let movie = 0;
  let series = 0;
  let live = 0;
  if (VOD_GROUP.test(g)) movie += 3;
  if (SERIES_GROUP.test(g)) series += 4;
  if (/\blive\b/i.test(g)) live += 4;
  if (LIVE_GROUP.test(g)) live += 3;
  if (/\b(tv|live)\b/i.test(g) && /\b(entertainment|sports?|news|music|kids)\b/i.test(g)) live += 2;
  if (/\b(movies?|vod|films?)\b/i.test(g) && /\b(tv|live)\b/i.test(g)) movie += 1;
  return { movie, series, live };
}

function scoreName(name: string): { movie: number; series: number; live: number } {
  const n = name;
  if (SERIES_EPISODE_HINT.test(n)) return { movie: 0, series: 5, live: 0 };
  let movie = 0;
  let live = 0;
  if (MOVIE_NAME_HINT.test(n)) movie += 3;
  if (LIVE_NAME_CONTENT.test(n)) live += 3;
  if (/\b(episodes?|season)\b/i.test(n)) movie += 0;
  if (/\b(season\s*\d|ep\s*\d+)\b/i.test(n)) return { movie: 0, series: 5, live: 0 };
  return { movie, series: 0, live };
}

/** Strip provider prefixes/suffixes and quality tags to expose a clean title. */
export function cleanTitle(name: string): string {
  return name
    .replace(PREFIX_TAG, '')
    .replace(/\s*[\[(|]\s*(?:HD|SD|FHD|UHD|4K|1080p?|720p?|576p?|480p?|360p?|Backup|B?)\s*[\])]\s*$/i, '')
    .replace(/\s*[\[(|-]\s*(?:HD|SD|FHD|UHD|4K|1080p?|720p?|576p?|480p?|360p?)\s*[\])|-]\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Detect country from a leading region tag (best effort, may be empty). */
const COUNTRY_TAGS: Record<string, string> = {
  us: 'US', uk: 'GB', gb: 'GB', ca: 'CA', au: 'AU', in: 'IN', pk: 'PK',
  bd: 'BD', lk: 'LK', np: 'NP', sa: 'SA', ae: 'AE', qa: 'QA', kw: 'KW',
  om: 'OM', eg: 'EG', za: 'ZA', ng: 'NG', ke: 'KE', de: 'DE', fr: 'FR',
  es: 'ES', it: 'IT', nl: 'NL', be: 'BE', pt: 'PT', ru: 'RU', tr: 'TR',
  ar: 'AR', br: 'BR', mx: 'MX', pl: 'PL', cz: 'CZ', sk: 'SK', hu: 'HU',
  ro: 'RO', gr: 'GR', jp: 'JP', kr: 'KR', cn: 'CN', th: 'TH', my: 'MM',
  ph: 'PH', vn: 'VN', id: 'ID', ir: 'IR', iq: 'IQ', jo: 'JO', il: 'IL',
  sg: 'SG', hk: 'HK', tw: 'TW', ch: 'CH', at: 'AT', se: 'SE', no: 'NO',
  fi: 'FI', dk: 'DK', eu: 'EU',
};

const LANGUAGE_TAGS: Record<string, string> = {
  hindi: 'Hindi', kannada: 'Kannada', tamil: 'Tamil', telugu: 'Telugu',
  malayalam: 'Malayalam', marathi: 'Marathi', bengali: 'Bengali',
  gujarati: 'Gujarati', punjabi: 'Punjabi', urdu: 'Urdu', english: 'English',
  arabic: 'Arabic', french: 'French', german: 'German', spanish: 'Spanish',
  chinese: 'Chinese', mandarin: 'Mandarin', cantonese: 'Cantonese',
  japanese: 'Japanese', korean: 'Korean', russian: 'Russian', portuguese: 'Portuguese',
  italian: 'Italian', dutch: 'Dutch',
};

export function detectCountry(name: string, group: string): string {
  const explicit = /^(?:[A-Z]{2})[:|\-–]\s*/.exec(name) ?? /^(?:[A-Z]{2})[:|\-–]\s*/.exec(group);
  if (explicit) {
    const code = explicit[0].slice(0, 2).toUpperCase();
    if (COUNTRY_TAGS[code.toLowerCase()]) return code;
  }
  return '';
}

export function normalizeLanguage(raw: string): string {
  if (!raw) return '';
  const first = raw.split(/[,/|;]/)[0].trim();
  if (!first) return '';
  const lower = first.toLowerCase();
  if (LANGUAGE_TAGS[lower]) return LANGUAGE_TAGS[lower];
  if (lower.length === 2 || lower.length === 3) return first;
  if (/^[a-z]{2}$/i.test(first)) return first.toUpperCase();
  return first;
}

const MIN_CONFIDENCE = 2;
/** A group/name signal this strong is authoritative and beats container evidence. */
const STRONG = 4;

export function detectKind(input: ClassifyInput): ContentKind {
  const { name, group, tvgId, attrs, hasVodMarker, streamUrl } = input;

  // 1. Explicit provider metadata always wins.
  const kodiType = attrs['kodi-type'];
  if (kodiType) {
    const t = kodiType.toLowerCase();
    if (t === 'movie') return 'movie';
    if (t === 'episode' || t === 'series') return 'series';
  }

  const gs = scoreGroup(group);
  const ns = scoreName(name);

  // A tvg-id that looks like a channel id (e.g. `bbc.uk`, `espn.us`) is a
  // strong live signal, since VOD providers rarely set it per title.
  const tvgLiveBonus = tvgId && /\.[a-z]{2,3}$/i.test(tvgId) ? 2 : 0;

  const series = gs.series + ns.series;
  let live = gs.live + ns.live + tvgLiveBonus;
  const movie = gs.movie + ns.movie;

  // 2. A strong group or episode signal is authoritative. Series and
  //    documentary VOD are both shipped as `.mp4`, so container evidence must
  //    not be able to outvote them.
  if (series >= STRONG) return 'series';
  if (live >= STRONG) return 'live';

  // 3. Container evidence decides when no group or title signal claimed the
  //    entry. This is what rescues movies filed under generic groups such as
  //    "Entertainment", "ENGLISH" or nothing at all — the common case that used
  //    to leave the Movies page empty.
  const url = streamUrl ?? '';
  if (CONTAINER_VOD.test(url)) return 'movie';
  // A `.ts` stream is a *hint*, not proof, and deliberately does not return
  // early. IPTV providers package a great deal of VOD as transport streams, so
  // the decisive rule this replaces filed an entire movie catalogue as live TV
  // — a `group-title` of "Movies" or "VOD" could not outvote it. The same
  // weight as a channel-style tvg-id lets group evidence win, while a channel
  // with no other evidence still lands on live via the score below.
  if (CONTAINER_LIVE.test(url)) live += 2;

  // 4. Fall back to blended scoring for the ambiguous middle: HLS URLs (used by
  //    both live and VOD), missing groups, and provider markers.
  if (hasVodMarker) return series > movie ? 'series' : 'movie';

  const m = movie + (hasVodMarker ? 2 : 0);
  if (series >= MIN_CONFIDENCE && series >= m && series >= live) return 'series';
  if (m >= MIN_CONFIDENCE && m > live) return 'movie';
  if (live >= MIN_CONFIDENCE) return 'live';
  if (m > live && m > 0) return 'movie';

  return 'other';
}

export { CONTAINER_LIVE, CONTAINER_VOD, LIVE_GROUP, SERIES_EPISODE_HINT, SERIES_GROUP, VOD_GROUP };
