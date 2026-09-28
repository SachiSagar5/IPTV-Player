/**
 * Poster store — a small `Store` plus a deliberately slow queue.
 *
 * The governing constraint is that we are borrowing a free community service, so
 * "how many cards are on screen" must never translate into "how many requests".
 * The queue therefore:
 *   - runs one request at a time, with a courtesy gap between requests,
 *   - is fed by card *mounts*, not by the playlist, so a 40,000-entry playlist
 *     the user never scrolls costs zero requests,
 *   - de-duplicates by cache key, so a title repeated across 40 channels is one call,
 *   - caches misses, so an unmatched title is never retried,
 *   - trips a circuit breaker if the endpoint starts failing, and stops entirely
 *     rather than hammering something that is down.
 */
import { Store } from '@/store/store';
import { lookupPoster, normalizeSearchTitle } from '@/services/metadata/cinemeta';
import {
  clearPosterCache,
  posterCacheKey,
  prunePosterCache,
  readCachedPoster,
  writePosterCache,
} from '@/services/metadata/posterCache';

export interface PosterResult {
  poster: string;
  imdbId: string;
  name: string;
  year?: number;
}

/** cache key -> result, or `null` for a known miss. */
export type PosterMap = Record<string, PosterResult | null>;

export const posterStore = new Store<PosterMap>({});

/** keys currently being fetched. */
const inFlight = new Set<string>();
/** keys waiting to run. */
const queue: Array<{ key: string; title: string; kind: 'movie' | 'series'; year?: number }> = [];
let running = false;
let pumpTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveMisses = 0;

/** Minimum milliseconds between two outbound requests. */
const MIN_GAP_MS = 350;
/** Consecutive failures before the breaker opens. */
const BREAKER_THRESHOLD = 8;
const BREAKER_COOLDOWN_MS = 60_000;

let breakerUntil = 0;
let cacheReady = false;

/** Build the cache key a title will be looked up under, or `null` if unsearchable. */
export function keyForTitle(kind: 'movie' | 'series', title: string): string | null {
  const normalized = normalizeSearchTitle(title);
  if (normalized.length < 2) return null;
  return posterCacheKey(kind, normalized);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function put(key: string, value: PosterResult | null): void {
  posterStore.patch((prev) => {
    if (Object.is(prev[key], value)) return prev;
    return { ...prev, [key]: value };
  });
}

async function resolveKey(
  key: string,
  title: string,
  kind: 'movie' | 'series',
  year: number | undefined,
): Promise<void> {
  if (key in posterStore.getState()) return;

  // 1. Persistent cache, consulted once the DB is known to be reachable.
  if (cacheReady) {
    const row = await readCachedPoster(key);
    if (row) {
      put(
        key,
        row.poster
          ? {
              poster: row.poster,
              imdbId: row.imdbId ?? '',
              name: row.name ?? title,
              year: row.year ?? undefined,
            }
          : null,
      );
      return;
    }
  }

  // 2. Network. `lookupPoster` swallows transport errors and returns null, so
  //    we cannot distinguish "no match" from "endpoint down" — hence the breaker
  //    counts consecutive misses and is reset by any success.
  const match = await lookupPoster(title, { kind, year });
  if (match) consecutiveMisses = 0;
  else consecutiveMisses += 1;
  if (consecutiveMisses >= BREAKER_THRESHOLD) {
    breakerUntil = Date.now() + BREAKER_COOLDOWN_MS;
    consecutiveMisses = 0;
  }

  const value: PosterResult | null = match
    ? { poster: match.poster, imdbId: match.imdbId, name: match.name, year: match.year }
    : null;
  put(key, value);
  writePosterCache({
    key,
    poster: value?.poster ?? null,
    imdbId: value?.imdbId ?? null,
    name: value?.name ?? null,
    year: value?.year ?? null,
    at: Date.now(),
  });
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      if (Date.now() < breakerUntil) {
        const retryIn = Math.max(1000, breakerUntil - Date.now());
        if (pumpTimer) clearTimeout(pumpTimer);
        pumpTimer = setTimeout(() => {
          pumpTimer = null;
          void pump();
        }, retryIn);
        return;
      }
      const job = queue.shift()!;
      inFlight.delete(job.key);
      if (job.key in posterStore.getState()) continue;
      await sleep(MIN_GAP_MS);
      if (job.key in posterStore.getState()) continue;
      await resolveKey(job.key, job.title, job.kind, job.year);
    }
  } finally {
    running = false;
  }
}

function schedule(): void {
  if (pumpTimer || running) return;
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    void pump();
  }, 0);
}

/**
 * Ask for a poster. Safe to call from every render of every card: it returns
 * the cache key synchronously, de-duplicates, and does no I/O.
 */
export function requestPoster(
  kind: 'movie' | 'series',
  title: string,
  year?: number,
): string | null {
  const key = keyForTitle(kind, title);
  if (!key) return null;
  if (key in posterStore.getState()) return key;
  if (inFlight.has(key)) return key;
  inFlight.add(key);
  queue.push({ key, title, kind, year });
  schedule();
  return key;
}

/** Forget one cached result so the next request re-resolves it. */
export function invalidatePoster(key: string): void {
  posterStore.patch((prev) => {
    if (!(key in prev)) return prev;
    const next = { ...prev };
    delete next[key];
    return next;
  });
}

export function clearAllPosters(): void {
  queue.length = 0;
  inFlight.clear();
  consecutiveMisses = 0;
  breakerUntil = 0;
  clearPosterCache();
  posterStore.setState({});
}

export { clearPosterCache };

/** Marks the persistent cache usable and prunes it. Call once at startup. */
export function hydratePosterCache(): void {
  if (cacheReady) return;
  cacheReady = true;
  prunePosterCache();
}
