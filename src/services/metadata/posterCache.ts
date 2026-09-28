/**
 * Persistent poster cache.
 *
 * The single reason this is not a plain `Map`: a poster is a fact about a *title*,
 * not about a playlist or an entry, so it should outlive playlist reloads, entry
 * renumbering and app restarts. Keying on the normalised title means every
 * playlist containing "Inception (2010)" reuses a single lookup forever.
 *
 * Misses are cached too, under the same key. Without that, every unmatchable
 * title would be re-requested on every visit — the failure mode that would
 * actually get this endpoint blocked.
 */
import { STORE, clearStore, del, get, getAll, getAllByIndex, put } from '../storage/db';

/** Bumped if the matching rules change, so stale decisions are not reused. */
const KEY_PREFIX = 'poster:1:';
/** Positive results are stable (IMDb poster URLs do not change). */
const TTL_HIT_MS = 60 * 24 * 60 * 60 * 1000;
/** A miss is re-checked sooner, in case the service was briefly incomplete. */
const TTL_MISS_MS = 7 * 24 * 60 * 60 * 1000;
/** Upper bound so a long-lived install cannot grow the store without limit. */
const MAX_ROWS = 20000;

export interface PosterCacheRow {
  key: string;
  poster: string | null;
  imdbId: string | null;
  name: string | null;
  year: number | null;
  at: number;
}

/** Includes the kind, so a movie and a series sharing a title never collide. */
export function posterCacheKey(kind: string, normalizedTitle: string): string {
  return `${KEY_PREFIX}${kind}:${normalizedTitle.toLowerCase()}`;
}

/** Returns the cached row if present and unexpired, else `null`. */
export async function readCachedPoster(key: string): Promise<PosterCacheRow | null> {
  try {
    const row = await get<PosterCacheRow>(STORE.posters, key);
    if (!row) return null;
    const ttl = row.poster ? TTL_HIT_MS : TTL_MISS_MS;
    return Date.now() - row.at > ttl ? null : row;
  } catch {
    // The cache is an optimisation. If IndexedDB is unavailable or the schema is
    // stale, every caller must still work — just uncached.
    return null;
  }
}

/**
 * Serialised so a burst of resolutions cannot open a transaction storm, and
 * fire-and-forget so a failed write never surfaces to the user.
 */
let writeChain: Promise<unknown> = Promise.resolve();

function serialise(task: () => Promise<unknown>): void {
  writeChain = writeChain.then(task).catch(() => undefined);
}

export function writePosterCache(row: PosterCacheRow): void {
  serialise(async () => {
    try {
      await put<PosterCacheRow>(STORE.posters, row);
    } catch {
      // ignore
    }
  });
}

/** Drops the oldest rows once the store exceeds `MAX_ROWS`. */
export function prunePosterCache(): void {
  serialise(async () => {
    try {
      const all = await getAllByIndex<PosterCacheRow>(
        STORE.posters,
        'at',
        IDBKeyRange.upperBound(Date.now()),
      );
      if (all.length <= MAX_ROWS) return;
      all.sort((a: PosterCacheRow, b: PosterCacheRow) => a.at - b.at);
      const excess = all.length - MAX_ROWS;
      for (let i = 0; i < excess; i += 1) {
        await del(STORE.posters, all[i].key);
      }
    } catch {
      // ignore
    }
  });
}

export async function clearPosterCache(): Promise<void> {
  serialise(async () => {
    try {
      await clearStore(STORE.posters);
    } catch {
      // ignore
    }
  });
}

export async function countCachedPosters(): Promise<number> {
  try {
    const all = await getAll<PosterCacheRow>(STORE.posters);
    return all.length;
  } catch {
    return 0;
  }
}
