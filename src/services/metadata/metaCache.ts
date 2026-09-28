/**
 * Persistent rating cache, keyed by IMDb id.
 *
 * Same reasoning as `posterCache`, one level up: a rating is a fact about the
 * *work*, not about a playlist entry, so "Inception" should be looked up once
 * forever no matter how many channels carry it or how often the playlist reloads.
 * Keying on the IMDb id (rather than the title) also means a title the app
 * matched loosely still shares one answer.
 *
 * Kept in its own store because most titles never get a rating lookup at all —
 * only the ones actually watched. Reusing the poster rows would have forced
 * "never looked up" and "looked up, genuinely unrated" into the same `null`.
 */
import { STORE, clearStore, del, get, getAll, getAllByIndex, put } from '../storage/db';

/** IMDb scores drift slowly, so a hit stays fresh for weeks. */
const TTL_HIT_MS = 30 * 24 * 60 * 60 * 1000;
/** A miss is re-checked sooner, in case the work simply had not been rated yet. */
const TTL_MISS_MS = 7 * 24 * 60 * 60 * 1000;
/** Bound the store; far more titles than anyone watches in a month. */
const MAX_ROWS = 5000;

export interface MetaCacheRow {
  key: string;
  rating: number | null;
  at: number;
}

/** The IMDb id is already namespaced by prefix (`tt`), so it is a safe key. */
export function metaCacheKey(imdbId: string): string {
  return `meta:1:${imdbId}`;
}

/** Returns the cached row if present and unexpired, else `null`. */
export async function readCachedMeta(key: string): Promise<MetaCacheRow | null> {
  try {
    const row = await get<MetaCacheRow>(STORE.meta, key);
    if (!row) return null;
    const ttl = row.rating === null || row.rating === undefined ? TTL_MISS_MS : TTL_HIT_MS;
    return Date.now() - row.at > ttl ? null : row;
  } catch {
    // The cache is an optimisation. If IndexedDB is unavailable or the schema is
    // stale, every caller must still work — just uncached.
    return null;
  }
}

let writeChain: Promise<unknown> = Promise.resolve();

function serialise(task: () => Promise<unknown>): void {
  writeChain = writeChain.then(task).catch(() => undefined);
}

export function writeMetaCache(row: MetaCacheRow): void {
  serialise(async () => {
    try {
      await put<MetaCacheRow>(STORE.meta, row);
    } catch {
      // ignore
    }
  });
}

export function pruneMetaCache(): void {
  serialise(async () => {
    try {
      const all = await getAllByIndex<MetaCacheRow>(
        STORE.meta,
        'at',
        IDBKeyRange.upperBound(Date.now()),
      );
      if (all.length <= MAX_ROWS) return;
      all.sort((a: MetaCacheRow, b: MetaCacheRow) => a.at - b.at);
      const excess = all.length - MAX_ROWS;
      for (let i = 0; i < excess; i += 1) {
        await del(STORE.meta, all[i].key);
      }
    } catch {
      // ignore
    }
  });
}

export async function clearMetaCache(): Promise<void> {
  serialise(async () => {
    try {
      await clearStore(STORE.meta);
    } catch {
      // ignore
    }
  });
}

export async function countCachedMeta(): Promise<number> {
  try {
    const all = await getAll<MetaCacheRow>(STORE.meta);
    return all.length;
  } catch {
    return 0;
  }
}
