/**
 * Poster lookup via Cinemeta (the Stremio metadata addon).
 *
 * Why this source: it needs no API key, no account and no sign-up, it serves
 * `Access-Control-Allow-Origin: *` so the browser can call it directly, and it
 * answers both `movie` and `series` searches with an IMDb id and a poster URL.
 * That combination is rare — TMDB, OMDb and Trakt all want a key, and IMDb
 * itself has no public API.
 *
 * It is a free community service, so everything here is written to treat it as
 * a courtesy: one request at a time, a minimum gap between requests, a hard
 * timeout, aggressive caching, and negative caching so an unmatched title is
 * never looked up twice. See `posterStore` for the queue.
 */
import { cleanTitle } from '@/services/m3u/categorize';

const BASE = 'https://v3-cinemeta.strem.io';
const TIMEOUT_MS = 6000;

export type PosterKind = 'movie' | 'series';

export interface PosterMatch {
  /** IMDb id, e.g. `tt1375666`. */
  imdbId: string;
  name: string;
  year?: number;
  poster: string;
}

/** One candidate as returned by the endpoint, before we judge it. */
interface RawMeta {
  id?: string;
  name?: string;
  poster?: string;
  releaseInfo?: string;
  imdbRating?: string | number;
}

interface CatalogResponse {
  metas?: RawMeta[];
}

interface MetaResponse {
  meta?: RawMeta;
}

/** What the per-title endpoint can tell us about a work. */
export interface TitleRating {
  /** IMDb score, 0–10, e.g. `8.8`. Absent when the work is unrated. */
  rating?: number;
}

/**
 * One GET, with the courtesy defaults this service deserves.
 *
 * Both endpoints share it so a request can never accidentally be made without a
 * timeout and an `Accept` header: a hung request would otherwise pin a queue
 * slot forever. Caller signals are composed with the timeout so cancelling one
 * cancels the other.
 */
async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const signals = [timeout.signal, signal].filter(Boolean) as AbortSignal[];
  const onAbort = (): void => timeout.abort();
  for (const s of signals) {
    if (s.aborted) timeout.abort();
    else s.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const response = await fetch(url, {
      signal: timeout.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // Timeout, abort, offline, malformed JSON: all treated as "no answer".
    return null;
  } finally {
    clearTimeout(timer);
    for (const s of signals) s.removeEventListener('abort', onAbort);
  }
}

/**
 * Strips the noise providers staple onto titles so the search has a chance:
 * quality/resolution tags, audio and language tags, bracketed extras, a
 * trailing year, and any leading resolution label.
 *
 * The parser already runs `cleanTitle` for display; this is the more aggressive
 * pass that also drops the year and bracketed groups, which are noise for a
 * search but useful for display.
 */
export function normalizeSearchTitle(raw: string): string {
  let title = raw;

  // `#EXTINF` display names often carry a leading region/language tag.
  title = title.replace(/^[\s|]+/, '');

  // Bracketed groups anywhere: [HD], [4K], [Hindi], [English Dubbed], (2021).
  title = title.replace(/[[({][^\])}]*[\])}]/g, ' ');

  // A trailing or standalone 4-digit year is metadata, not part of the title.
  title = title.replace(/\b(19|20)\d{2}\b/g, ' ');

  // Bare quality / audio / codec tokens, with or without brackets already removed.
  title = title
    .replace(
      /\b(4k|uhd|fhd|hd|sd|hq|bluray|blu-ray|bdrip|brrip|webrip|web-?dl|hdrip|dvdrip|remux|hdtv|amzn|nf|disney|hotstar|prime)\b/gi,
      ' ',
    )
    .replace(
      /\b(dual\s*audio|multi\s*audio|hindi\s*dubbed?|dubbed|english\s*dubbed?|subbed|extended|unrated|remastered|proper|repack|retail)\b/gi,
      ' ',
    )
    // Resolution: 1080p, 720p, 2160p, 480i. Must precede the codec rule so
    // "x265" is not mistaken for a title fragment.
    .replace(/\b\d{3,4}[pi]\b/gi, ' ')
    .replace(/\bx26[45]\b|\bx264\b/gi, ' ')
    .replace(/\b\d{1,2}bit\b/gi, ' ')
    .replace(
      /\b(hdr10\+?|hdr|sdr|dv|dolby\s*vision|truehd|atmos|dd\+?|ddp|eac3|dts-?hd?|dd|aac|flac|opus|5\.1|7\.1)\b/gi,
      ' ',
    );

  // Separator noise: "Movie.Name.2021.1080p.BluRay" -> "Movie Name".
  // Colons matter here: IMDb writes "The Lord of the Rings: The Fellowship of
  // the Ring" while providers flatten it to dots, and both must normalise alike.
  title = title.replace(/[._:;]+/g, ' ');
  // Strip a trailing language code like "_HIN" or "-GER".
  title = title.replace(
    /\b(hin|eng|tam|tel|mal|kan|ben|mar|pan|guj|punj|urd|ara|fre|ger|spa|ita|rus|jpn|kor|chi|nld|por|tur|pol|cze|hun|ron|gre|heb|swe|dan|fin|nor|dut)\b\s*$/i,
    ' ',
  );
  // Trailing/leading decoration left behind by the passes above.
  title = title.replace(/^[\s|~+\-]+|[\s|~+\-]+$/g, '');

  return cleanTitle(title.replace(/\s{2,}/g, ' ').trim());
}

/**
 * IMDb's older title convention sorts a trailing article to the end
 * ("Matrix, The"). Providers almost always write it the natural way
 * ("The Matrix"), so both sides are un-inverted before comparison.
 */
function unInvert(title: string): string {
  const m = /^(.*),\s*(The|A|An|Le|La|Los|Las|Il|Der|Die|Das|El|Den|Det)$/i.exec(title);
  if (!m) return title;
  return `${m[2]} ${m[1]}`;
}

/**
 * True when the candidate is the same work we searched for.
 *
 * This is deliberately *exact* (after normalisation). Fuzzy matching looked
 * attractive and was wrong: a prefix rule happily returned "The Dark Knight
 * Rises" for a search for "The Dark Knight", because both are 2012. On a movie
 * grid that is a wrong poster on every card in a row, and a wrong poster is
 * worse than no poster — it is a confident lie about what you are about to play.
 *
 * A miss is cheap: the card shows a monogram, exactly as it does today. So the
 * trade is heavily in favour of strictness.
 *
 * The one fuzzy case handled is IMDb's inverted title convention ("Matrix, The"),
 * which is applied on both sides before comparing.
 */
export function isPlausibleMatch(
  wanted: string,
  wantedYear: number | undefined,
  candidate: { name: string; year?: number },
): boolean {
  const a = normalizeSearchTitle(wanted);
  const b = normalizeSearchTitle(candidate.name);
  if (!a || !b) return false;

  // A known year on one side and a *different* known year on the other is a hard
  // no. Distinct films routinely share an exact title — "The Thing" (1982/2011),
  // "The Office" (2005/2019) — and those are the worst mis-attachments possible.
  if (wantedYear && candidate.year && wantedYear !== candidate.year) return false;

  return unInvert(a) === unInvert(b);
}

/** `releaseInfo` is a loose string: "2010", "2008-2013", "2025-". */
function parseYear(releaseInfo: string | undefined): number | undefined {
  if (!releaseInfo) return undefined;
  const m = /(\d{4})/.exec(releaseInfo);
  return m ? Number(m[1]) : undefined;
}

function bestPoster(meta: RawMeta): string | undefined {
  if (meta.poster) return meta.poster;
  const id = meta.id;
  // Fall back to Stremio's own image cache, which needs no key.
  if (id) return `https://images.metahub.space/poster/medium/${id}/img`;
  return undefined;
}

/**
 * Searches Cinemeta. Resolves `null` for "no confident match" — a miss is a
 * normal outcome, not an error, and is cached as such by the caller.
 */
export async function lookupPoster(
  title: string,
  options: { kind?: PosterKind; year?: number; signal?: AbortSignal } = {},
): Promise<PosterMatch | null> {
  const query = normalizeSearchTitle(title);
  // Nothing searchable (a title that was *only* quality tags, say).
  if (query.length < 2) return null;

  const kind: PosterKind = options.kind === 'series' ? 'series' : 'movie';
  const url = `${BASE}/catalog/${kind}/top/search=${encodeURIComponent(query)}.json`;

  const data = await getJson<CatalogResponse>(url, options.signal);
  const candidates = data?.metas ?? [];

  for (const meta of candidates) {
    if (!meta?.id || !meta.name) continue;
    const year = parseYear(meta.releaseInfo);
    if (!isPlausibleMatch(query, options.year, { name: meta.name, year })) continue;
    const poster = bestPoster(meta);
    if (!poster) continue;
    return { imdbId: meta.id, name: meta.name, year, poster };
  }
  return null;
}

/**
 * Parses the IMDb score. The endpoint sends it as a *string* (`"8.8"`) and
 * sometimes as an empty string for an unrated title, so this has to survive both
 * and refuse anything outside 0–10 rather than paint a nonsense number on screen.
 */
export function parseRating(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0 || n > 10) return undefined;
  return Math.round(n * 10) / 10;
}

/**
 * Looks up a work's rating by IMDb id.
 *
 * Separate from `lookupPoster` because the search endpoint that resolves the
 * poster does not carry ratings — only the per-title endpoint does. So a rating
 * costs a second request, which is why this is driven by the watch/detail
 * surfaces (one title at a time) and not by grid cards: the poster queue's whole
 * design rests on "cards on screen must not become requests", and a second
 * request per mounted card would break that.
 */
export async function lookupRating(
  imdbId: string,
  options: { kind?: PosterKind; signal?: AbortSignal } = {},
): Promise<TitleRating | null> {
  if (!/^tt\d+$/.test(imdbId)) return null;
  const kind: PosterKind = options.kind === 'series' ? 'series' : 'movie';
  const data = await getJson<MetaResponse>(`${BASE}/meta/${kind}/${imdbId}.json`, options.signal);
  if (!data?.meta) return null;
  const rating = parseRating(data.meta.imdbRating);
  return rating === undefined ? null : { rating };
}
