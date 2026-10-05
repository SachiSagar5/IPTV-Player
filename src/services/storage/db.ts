/**
 * Minimal, typed promise wrapper over IndexedDB.
 *
 * Deliberately hand-rolled instead of pulling in `idb`: the surface we need is
 * small (7 stores, cursor + range reads, bulk writes) and this keeps the bundle
 * free of another dependency on the critical startup path.
 *
 * Design notes
 *  - One long-lived connection is reused; `blocked` is surfaced so a second
 *    browser tab cannot silently stall a playlist refresh.
 *  - Playlist entries are written in **chunks** (see `items` store). A 60k-entry
 *    playlist becomes ~30 records of 2k items, which keeps individual
 *    transactions small enough to stay off the long-task list and makes it
 *    possible to page entries back in lazily.
 */

export const DB_NAME = 'iptv-player';
export const DB_VERSION = 4;

/** Entries per IndexedDB record. Tuned for write latency vs. read count. */
export const ITEMS_PER_CHUNK = 2000;

export const STORE = {
  playlists: 'playlists',
  items: 'items',
  progress: 'progress',
  favorites: 'favorites',
  recent: 'recent',
  kv: 'kv',
  posters: 'posters',
  meta: 'meta',
  liveHealth: 'liveHealth',
  introTimestamps: 'introTimestamps',
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];

let dbPromise: Promise<IDBDatabase> | null = null;
let blockedHandler: (() => void) | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function upgradeSchema(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(STORE.playlists)) {
    db.createObjectStore(STORE.playlists, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(STORE.items)) {
    // keyPath ['playlistId','chunk'] — range scans by playlist are index-free.
    db.createObjectStore(STORE.items, { keyPath: ['playlistId', 'chunk'] });
  }
  if (!db.objectStoreNames.contains(STORE.progress)) {
    const store = db.createObjectStore(STORE.progress, { keyPath: 'contentId' });
    store.createIndex('updatedAt', 'updatedAt');
    store.createIndex('playlistId', 'playlistId');
  }
  if (!db.objectStoreNames.contains(STORE.favorites)) {
    const store = db.createObjectStore(STORE.favorites, { keyPath: 'contentId' });
    store.createIndex('addedAt', 'addedAt');
    store.createIndex('playlistId', 'playlistId');
  }
  if (!db.objectStoreNames.contains(STORE.recent)) {
    const store = db.createObjectStore(STORE.recent, { keyPath: 'contentId' });
    store.createIndex('watchedAt', 'watchedAt');
    store.createIndex('playlistId', 'playlistId');
  }
  if (!db.objectStoreNames.contains(STORE.kv)) {
    db.createObjectStore(STORE.kv);
  }
  if (!db.objectStoreNames.contains(STORE.posters)) {
    // keyPath 'key' — the cache key is derived from the title, so a playlist
    // reload hits the cache instead of the network. `at` is used to expire rows.
    const store = db.createObjectStore(STORE.posters, { keyPath: 'key' });
    store.createIndex('at', 'at');
  }
  if (!db.objectStoreNames.contains(STORE.meta)) {
    // keyPath 'key' — the IMDb id, since a rating is a fact about the *work* and
    // outlives whichever playlist entry it was reached through. Separate from
    // `posters` because most titles never get a rating lookup at all: only the
    // ones actually watched do, and those must not be recorded as "no rating".
    const store = db.createObjectStore(STORE.meta, { keyPath: 'key' });
    store.createIndex('at', 'at');
  }
  if (!db.objectStoreNames.contains(STORE.liveHealth)) {
    // keyPath 'contentId' — one row per channel, overwritten on each failure
    // rather than appended, so a channel that errors repeatedly costs one row.
    // `at` is the TTL index (rows are pruned once they stop being useful) and
    // `playlistId` makes "forget this playlist" a range delete instead of a
    // full-table scan.
    const store = db.createObjectStore(STORE.liveHealth, { keyPath: 'contentId' });
    store.createIndex('at', 'at');
    store.createIndex('playlistId', 'playlistId');
  }
  if (!db.objectStoreNames.contains(STORE.introTimestamps)) {
    // keyPath 'contentId' — one row per VOD item, stores intro start/end times
    // so users can skip intros for movies and series episodes.
    const store = db.createObjectStore(STORE.introTimestamps, { keyPath: 'contentId' });
    store.createIndex('playlistId', 'playlistId');
    store.createIndex('updatedAt', 'updatedAt');
  }
}

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export function onDbBlocked(handler: () => void): void {
  blockedHandler = handler;
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error('IndexedDB is not available in this browser'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      upgradeSchema(request.result);
    };
    request.onblocked = () => {
      blockedHandler?.();
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };
  });

  return dbPromise;
}

export async function txDone(tx: IDBTransaction): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  const value = await requestToPromise<T | undefined>(tx.objectStore(store).get(key));
  return value;
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  return requestToPromise<T[]>(tx.objectStore(store).getAll());
}

export async function getAllByIndex<T>(
  store: StoreName,
  indexName: string,
  query: IDBKeyRange,
): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  const index = tx.objectStore(store).index(indexName);
  return requestToPromise<T[]>(index.getAll(query));
}

export async function put<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const objectStore = tx.objectStore(store);
  if (key !== undefined) objectStore.put(value, key);
  else objectStore.put(value);
  await txDone(tx);
}

/** Single round-trip bulk write — critical for large playlist persistence. */
export async function putMany<T>(
  store: StoreName,
  values: T[],
  key?: IDBValidKey,
): Promise<void> {
  if (values.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const objectStore = tx.objectStore(store);
  for (const value of values) {
    if (key !== undefined) objectStore.put(value, key);
    else objectStore.put(value);
  }
  await txDone(tx);
}

export async function del(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await txDone(tx);
}

export async function clearStore(store: StoreName): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  await txDone(tx);
}

/** Read every chunk for one playlist, concatenated in chunk order. */
export async function readPlaylistItems<T>(playlistId: string): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(STORE.items, 'readonly');
  const store = tx.objectStore(STORE.items);
  const range = IDBKeyRange.bound([playlistId, -Infinity], [playlistId, Infinity]);
  const rows = await requestToPromise<Array<{ playlistId: string; chunk: number; items: T[] }>>(
    store.getAll(range),
  );
  rows.sort((a, b) => a.chunk - b.chunk);
  const out: T[] = [];
  for (const row of rows) {
    for (const item of row.items) out.push(item);
  }
  return out;
}

/** Replace a playlist's entries in one transaction (delete + write chunks). */
export async function replacePlaylistItems<T>(
  playlistId: string,
  chunks: T[][],
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE.items, 'readwrite');
  const store = tx.objectStore(STORE.items);
  store.delete(
    IDBKeyRange.bound([playlistId, -Infinity], [playlistId, Infinity]),
  );
  for (let i = 0; i < chunks.length; i++) {
    store.put({ playlistId, chunk: i, items: chunks[i] });
  }
  await txDone(tx);
}

export async function deletePlaylistItems(playlistId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE.items, 'readwrite');
  tx.objectStore(STORE.items).delete(
    IDBKeyRange.bound([playlistId, -Infinity], [playlistId, Infinity]),
  );
  await txDone(tx);
}

/** Rough on-disk usage, surfaced in Settings. */
export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

/** Ask the browser to exempt us from eviction under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
