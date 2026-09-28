/**
 * Playlist repository — the only place that knows how playlists are persisted.
 *
 * Persistence shape:
 *   playlists : PlaylistMeta                (one small record per playlist)
 *   items     : { playlistId, chunk, items } (2000 entries per record)
 *
 * Favourites / progress / recently-watched are keyed by `contentId`, which is
 * derived from `name + streamUrl`. Because that id is stable across refreshes,
 * a provider re-ordering its playlist never loses a user's favourites.
 */
import type { ContentItem, ContentKind, PlaylistMeta } from '@/types';
import {
  ITEMS_PER_CHUNK,
  STORE,
  clearStore,
  deletePlaylistItems,
  get,
  getAll,
  put,
  readPlaylistItems,
  replacePlaylistItems,
} from './db';

export const playlistsRepo = {
  async list(): Promise<PlaylistMeta[]> {
    const all = await getAll<PlaylistMeta>(STORE.playlists);
    return all.sort((a, b) => a.createdAt - b.createdAt);
  },

  async get(id: string): Promise<PlaylistMeta | undefined> {
    return get<PlaylistMeta>(STORE.playlists, id);
  },

  async save(meta: PlaylistMeta): Promise<void> {
    await put(STORE.playlists, meta);
  },

  async saveMany(metas: PlaylistMeta[]): Promise<void> {
    const db = await (await import('./db')).openDb();
    const tx = db.transaction(STORE.playlists, 'readwrite');
    const store = tx.objectStore(STORE.playlists);
    for (const meta of metas) store.put(meta);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  async remove(id: string): Promise<void> {
    await deletePlaylistItems(id);
    await (await import('./db')).del(STORE.playlists, id);
  },

  async loadItems(id: string): Promise<ContentItem[]> {
    return readPlaylistItems<ContentItem>(id);
  },

  /** Chunked so a 50k-entry write never blocks the main thread in one go. */
  async saveItems(id: string, items: ContentItem[]): Promise<number> {
    const chunks: ContentItem[][] = [];
    for (let i = 0; i < items.length; i += ITEMS_PER_CHUNK) {
      chunks.push(items.slice(i, i + ITEMS_PER_CHUNK));
    }
    if (chunks.length === 0) chunks.push([]);
    await replacePlaylistItems(id, chunks);
    return chunks.length;
  },

  /**
   * Free the cached entries for one playlist while keeping its metadata, so the
   * Playlists page still lists it and the user can re-download with one tap.
   */
  async clearItems(id: string): Promise<void> {
    await deletePlaylistItems(id);
  },

  async clear(): Promise<void> {
    await Promise.all([
      clearStore(STORE.playlists),
      clearStore(STORE.items),
      clearStore(STORE.progress),
      clearStore(STORE.favorites),
      clearStore(STORE.recent),
    ]);
  },
};

/** A fresh zeroed count record. Typed so a new `ContentKind` is a compile error. */
export const emptyCounts = (): Record<ContentKind, number> => ({
  live: 0,
  movie: 0,
  series: 0,
  other: 0,
});
