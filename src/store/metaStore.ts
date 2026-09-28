/**
 * Rating store — a small `Store` plus a queue that mirrors `posterStore`'s
 * courtesies.
 *
 * Why a separate store rather than a field on `posterStore`: a rating needs the
 * IMDb id, which only exists *after* a poster/title match, and the poster queue
 * is fed by card mounts. Rating lookups come from the watch and detail surfaces,
 * which are one-title-at-a-time. Merging them would have meant every mounted card
 * could trigger a second request, which is exactly the fan-out the poster queue
 * exists to prevent.
 *
 * The guarantees are the same as the poster queue's: one request at a time, a
 * courtesy gap, de-duplication by id, negative caching, and a circuit breaker
 * that stops entirely rather than hammering an endpoint that is failing.
 */
import { Store } from '@/store/store';
import { lookupRating, type PosterKind, type TitleRating } from '@/services/metadata/cinemeta';
import { lookupOmdbRating } from '@/services/metadata/omdb';
import { loadSettings } from '@/services/storage/prefs';
import {
  clearMetaCache,
  metaCacheKey,
  pruneMetaCache,
  readCachedMeta,
  writeMetaCache,
} from '@/services/metadata/metaCache';

/** imdbId -> rating, or `null` for a known miss. */
export type MetaMap = Record<string, TitleRating | null>;

export const metaStore = new Store<MetaMap>({});

/** ids currently being fetched. */
const inFlight = new Set<string>();
/** ids waiting to run, with the kind needed to build the endpoint. */
const queue: Array<{ id: string; kind: PosterKind }> = [];
let running = false;
let pumpTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveMisses = 0;

/**
 * Wider than the poster queue's 350ms: this endpoint is a per-title lookup
 * rather than a search, so a user skipping through a playlist can queue several
 * in quick succession, and this is the one request per title we cannot avoid.
 */
const MIN_GAP_MS = 900;
/** Consecutive failures before the breaker opens. */
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60_000;

/**
 * Hard ceiling on outbound lookups per local day.
 *
 * Uniquely among the services here, OMDb is metered: the free key allows 1,000
 * requests/day for the whole key, and a browse session can mount hundreds of
 * cards. The persistent cache means a given title costs at most one request for
 * weeks, so this only bites when someone scrolls a lot of never-seen titles —
 * and when it does, showing fewer ratings for the rest of the day is a far
 * better outcome than a dead key.
 *
 * Kept well under the provider's own limit so manual lookups and retries still
 * fit inside the quota.
 */
const DAILY_BUDGET = 250;

let breakerUntil = 0;
let cacheReady = false;

/** Requests spent today, with the local day they were spent on. */
let spentToday = 0;
let spentDay = new Date().toDateString();

/**
 * Bumped whenever everything is cleared.
 *
 * A request can still be awaiting its response when the cache is cleared, and it
 * would then write that stale answer back and resurrect the entry just discarded.
 * A resolution captures this value and drops its result if it changed mid-flight.
 */
let generation = 0;

/** True while the day's budget is already spent, so the queue can idle. */
function budgetExhausted(): boolean {
  const today = new Date().toDateString();
  if (today !== spentDay) {
    // A new local day resets the allowance.
    spentDay = today;
    spentToday = 0;
  }
  return spentToday >= DAILY_BUDGET;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function put(id: string, value: TitleRating | null): void {
  metaStore.patch((prev) => {
    if (id in prev && Object.is(prev[id], value)) return prev;
    return { ...prev, [id]: value };
  });
}

async function resolveId(id: string, kind: PosterKind): Promise<void> {
  if (id in metaStore.getState()) return;

  // Any result that arrives after a clear belongs to a cache that no longer
  // exists, so it is discarded rather than written back.
  const startedAt = generation;
  const stale = (): boolean => startedAt !== generation;

  const key = metaCacheKey(id);

  // 1. Persistent cache, consulted once the DB is known to be reachable.
  if (cacheReady) {
    const row = await readCachedMeta(key);
    if (stale()) return;
    if (row) {
      put(id, row.rating === null || row.rating === undefined ? null : { rating: row.rating });
      return;
    }
  }

  // 2. Network. The user's own OMDb key takes precedence; without one we fall
  //    back to Cinemeta, which needs neither key nor quota. Both helpers swallow
  //    transport errors, so a miss is indistinguishable from an outage — hence
  //    the breaker counts misses and is reset by any success.
  //
  //    A key that is wrong or over quota fails identically to a missing title,
  //    which is exactly why misses are cached: a bad key costs one request
  //    rather than one per card the visitor scrolls past.
  const apiKey = loadSettings().omdbApiKey.trim();
  const result = apiKey
    ? ((await lookupOmdbRating(id, apiKey)) as TitleRating | null)
    : await lookupRating(id, { kind });
  if (stale()) return;
  if (result) consecutiveMisses = 0;
  else consecutiveMisses += 1;
  if (consecutiveMisses >= BREAKER_THRESHOLD) {
    breakerUntil = Date.now() + BREAKER_COOLDOWN_MS;
    consecutiveMisses = 0;
  }

  put(id, result);
  writeMetaCache({ key, rating: result?.rating ?? null, at: Date.now() });
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
      if (budgetExhausted()) return; // Out of daily quota; the queue idles.
      const job = queue.shift()!;
      inFlight.delete(job.id);
      if (job.id in metaStore.getState()) continue;
      await sleep(MIN_GAP_MS);
      if (job.id in metaStore.getState()) continue;
      spentToday += 1;
      await resolveId(job.id, job.kind);
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
 * Ask for a rating. Safe to call from every render of a detail surface: it
 * returns synchronously, de-duplicates, and does no I/O.
 *
 * Returns `null` for a malformed id so callers can treat "no id, no rating" as
 * one case rather than queueing a request that is certain to fail.
 */
export function requestRating(imdbId: string, kind: PosterKind = 'movie'): string | null {
  if (!/^tt\d+$/.test(imdbId)) return null;
  if (imdbId in metaStore.getState()) return imdbId;
  if (inFlight.has(imdbId)) return imdbId;
  inFlight.add(imdbId);
  queue.push({ id: imdbId, kind });
  schedule();
  return imdbId;
}

/** Forget one cached result so the next request re-resolves it. */
export function invalidateRating(imdbId: string): void {
  metaStore.patch((prev) => {
    if (!(imdbId in prev)) return prev;
    const next = { ...prev };
    delete next[imdbId];
    return next;
  });
}

export function clearAllMeta(): void {
  queue.length = 0;
  inFlight.clear();
  consecutiveMisses = 0;
  breakerUntil = 0;
  generation += 1;
  clearMetaCache();
  metaStore.setState({});
}

export { clearMetaCache };

/** Marks the persistent cache usable and prunes it. Call once at startup. */
export function hydrateMetaCache(): void {
  if (cacheReady) return;
  cacheReady = true;
  pruneMetaCache();
}
