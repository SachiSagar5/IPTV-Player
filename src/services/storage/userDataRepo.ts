/**
 * User-data repository: favourites ("My List"), playback progress and recents.
 *
 * All three are keyed by the stable `contentId`, so refreshing a playlist keeps
 * the user's data intact. Progress is written throttled by the player
 * (every ~5s and on pause/unload) rather than on every `timeupdate`.
 */
import type { ContentItem, PlaybackProgress } from '@/types';
import { STORE, del, get, getAll, getAllByIndex, put } from './db';

export interface FavoriteRecord {
  contentId: string;
  playlistId: string;
  name: string;
  logo: string;
  kind: ContentItem['kind'];
  group: string;
  seriesId?: string;
  season?: number;
  episode?: number;
  addedAt: number;
}

export interface RecentRecord {
  contentId: string;
  playlistId: string;
  name: string;
  logo: string;
  kind: ContentItem['kind'];
  group: string;
  seriesId?: string;
  season?: number;
  episode?: number;
  watchedAt: number;
  /** Short human label such as "S2 E7" for the recents row. */
  label: string;
}

const MAX_RECENT = 60;

export const favoritesRepo = {
  async list(): Promise<FavoriteRecord[]> {
    const rows = await getAll<FavoriteRecord>(STORE.favorites);
    return rows.sort((a, b) => b.addedAt - a.addedAt);
  },

  async listForPlaylist(playlistId: string): Promise<FavoriteRecord[]> {
    const rows = await getAllByIndex<FavoriteRecord>(
      STORE.favorites,
      'playlistId',
      IDBKeyRange.only(playlistId),
    );
    return rows.sort((a, b) => b.addedAt - a.addedAt);
  },

  async add(item: ContentItem, now = Date.now()): Promise<void> {
    const record: FavoriteRecord = {
      contentId: item.id,
      playlistId: item.playlistId,
      name: item.name,
      logo: item.logo,
      kind: item.kind,
      group: item.group,
      seriesId: item.seriesId,
      season: item.season,
      episode: item.episode,
      addedAt: now,
    };
    await put(STORE.favorites, record);
  },

  async remove(contentId: string): Promise<void> {
    await del(STORE.favorites, contentId);
  },

  async has(contentId: string): Promise<boolean> {
    return (await get<FavoriteRecord>(STORE.favorites, contentId)) !== undefined;
  },
};

function toProgress(item: ContentItem, position: number, duration: number, watchedSec: number): PlaybackProgress {
  const safeDuration = duration > 0 ? duration : 0;
  return {
    contentId: item.id,
    playlistId: item.playlistId,
    name: item.name,
    logo: item.logo,
    kind: item.kind,
    group: item.group,
    seriesId: item.seriesId,
    season: item.season,
    episode: item.episode,
    position: Math.max(0, Math.floor(position)),
    duration: Math.floor(safeDuration),
    percent: safeDuration > 0 ? Math.min(1, position / safeDuration) : 0,
    updatedAt: Date.now(),
    watchedSec: Math.floor(watchedSec),
  };
}

export const progressRepo = {
  async list(): Promise<PlaybackProgress[]> {
    const rows = await getAll<PlaybackProgress>(STORE.progress);
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async get(contentId: string): Promise<PlaybackProgress | undefined> {
    return get<PlaybackProgress>(STORE.progress, contentId);
  },

  async save(item: ContentItem, position: number, duration: number, watchedSec: number): Promise<PlaybackProgress | null> {
    // Live TV has no meaningful position — never store progress for it.
    if (item.kind === 'live') return null;
    if (duration <= 0) return null;
    const record = toProgress(item, position, duration, watchedSec);
    // Almost-finished items are considered "watched" and pruned from the row.
    if (record.percent >= 0.97 || record.position < 10) {
      await del(STORE.progress, item.id);
      return null;
    }
    await put(STORE.progress, record);
    return record;
  },

  async remove(contentId: string): Promise<void> {
    await del(STORE.progress, contentId);
  },

  async removeMany(contentIds: string[]): Promise<void> {
    if (contentIds.length === 0) return;
    const { openDb, txDone } = await import('./db');
    const db = await openDb();
    const tx = db.transaction(STORE.progress, 'readwrite');
    const store = tx.objectStore(STORE.progress);
    for (const id of contentIds) store.delete(id);
    await txDone(tx);
  },
};

export const recentRepo = {
  async list(): Promise<RecentRecord[]> {
    const rows = await getAll<RecentRecord>(STORE.recent);
    return rows.sort((a, b) => b.watchedAt - a.watchedAt);
  },

  async record(item: ContentItem, label: string): Promise<void> {
    const record: RecentRecord = {
      contentId: item.id,
      playlistId: item.playlistId,
      name: item.name,
      logo: item.logo,
      kind: item.kind,
      group: item.group,
      seriesId: item.seriesId,
      season: item.season,
      episode: item.episode,
      watchedAt: Date.now(),
      label,
    };
    const db = await (await import('./db')).openDb();
    const tx = db.transaction(STORE.recent, 'readwrite');
    const store = tx.objectStore(STORE.recent);
    store.put(record);

    // Trim to MAX_RECENT using the watchedAt index.
    const cursorRequest = store.index('watchedAt').openCursor(null, 'prev');
    let seen = 0;
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      seen += 1;
      if (seen > MAX_RECENT) cursor.delete();
      cursor.continue();
    };

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  async clear(): Promise<void> {
    const { clearStore } = await import('./db');
    await clearStore(STORE.recent);
  },
};

export async function wipeUserData(): Promise<void> {
  await Promise.all([
    progressRepo.removeMany((await progressRepo.list()).map((p) => p.contentId)),
    recentRepo.clear(),
  ]);
  const { clearStore } = await import('./db');
  await clearStore(STORE.favorites);
}
