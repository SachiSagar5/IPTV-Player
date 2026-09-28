/**
 * Movie ratings via the OMDb API.
 *
 * Why OMDb: it is the one rating source that covers both movies and series and
 * needs no server. The trade is that it requires a per-user API key and meters
 * the free tier at 1,000 requests/day, so the key belongs to the user and is
 * never shipped in the bundle — see `AppSettings.omdbApiKey`. With no key
 * configured this module is never called, and ratings fall back to Cinemeta
 * (see `lookupRating` in `cinemeta.ts`), which needs neither key nor quota.
 *
 * Requests are keyed by IMDb id rather than title. We already have a confident
 * id from the existing title match, and `?i=` is an exact lookup, whereas
 * `?t=` would be a second, looser title search that can return a remake.
 */
const BASE = 'https://www.omdbapi.com';
const TIMEOUT_MS = 6000;

export interface OmdbRating {
  /** IMDb score, 0–10. */
  rating?: number;
  /** Raw vote count, e.g. `"2,857,902"`. */
  votes?: string;
}

/** OMDb sends the score as a string, and `"N/A"` for anything unrated. */
function parseScore(value: string | undefined): number | undefined {
  if (!value || value === 'N/A') return undefined;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0 || n > 10) return undefined;
  return Math.round(n * 10) / 10;
}

interface OmdbResponse {
  Response?: string;
  Error?: string;
  imdbRating?: string;
  imdbVotes?: string;
}

/**
 * Looks up one title's rating.
 *
 * Resolves `null` for "no answer" — an unrated title, a wrong id, a throttled or
 * exhausted key, a timeout, or an offline device are all the same to the caller,
 * and all are cached as a miss so a broken key costs one request, not one per
 * card. Callers must not treat `null` as "rated zero".
 */
export async function lookupOmdbRating(
  imdbId: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<OmdbRating | null> {
  if (!apiKey || !/^tt\d+$/.test(imdbId)) return null;
  const url = `${BASE}/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(apiKey)}`;

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const onAbort = (): void => timeout.abort();
  if (signal) {
    if (signal.aborted) timeout.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const response = await fetch(url, {
      signal: timeout.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as OmdbResponse;
    if (data.Response !== 'True') return null;
    const rating = parseScore(data.imdbRating);
    if (rating === undefined) return null;
    return { rating, votes: data.imdbVotes };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
