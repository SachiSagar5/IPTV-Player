/**
 * User-data repository: favourites ("My List"), playback progress, recents and
 * live-channel playback health.
 *
 * All four are keyed by the stable `contentId`, so refreshing a playlist keeps
 * the user's data intact. Progress is written throttled by the player
 * (every ~5s and on pause/unload) rather than on every `timeupdate`.
 */
import type { ContentItem, PlaybackProgress } from '@/types';
import type { PlayerErrorInfo } from '@/store/playerStore';
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

/**
 * A live channel that failed to play.
 *
 * Rows are *evidence*, not a verdict: the browse surfaces decide what to hide,
 * and only after a channel has failed more than once (see `isHiddenChannel`).
 * Keeping the raw record rather than a boolean is what makes "show hidden
 * channels" possible without re-probing anything.
 */
export interface LiveHealthRecord {
  contentId: string;
  playlistId: string;
  name: string;
  logo: string;
  group: string;
  /** Fatal errors seen against this channel, across sessions. */
  attempts: number;
  /**
   * Set when the engine declared the failure unrecoverable — an unsupported
   * container or a manifest that is not HLS. That is a property of the stream
   * itself rather than of the moment it was tried, so it hides the channel
   * immediately instead of waiting for a second confirmation.
   */
  unrecoverable: boolean;
  detail: string;
  /** Epoch ms of the most recent failure. */
  at: number;
}

/**
 * How long a failure record stays relevant.
 *
 * Long enough that a provider outage does not permanently amputate a chunk of
 * someone's channel list, short enough that a provider that comes back does not
 * stay hidden for days. The escape hatch is deliberately not TTL-based: a user
 * who knows a channel works can unhide the lot on request.
 */
export const LIVE_HEALTH_TTL_MS = 24 * 60 * 60 * 1000;

/** Failures needed before a channel is hidden. One fluke is not a verdict. */
const ATTEMPTS_BEFORE_HIDDEN = 2;

/**
 * Whether a recorded failure is enough to hide the channel.
 *
 * `unrecoverable` short-circuits this: the engine has already tried and failed
 * the recovery ladder, and a format the browser cannot decode will not start
 * decoding on the next attempt.
 */
export function isHiddenChannel(record: LiveHealthRecord, now = Date.now()): boolean {
  if (now - record.at > LIVE_HEALTH_TTL_MS) return false;
  return record.unrecoverable || record.attempts >= ATTEMPTS_BEFORE_HIDDEN;
}

export const liveHealthRepo = {
  /** Every record still inside its TTL, newest first. Expired rows are pruned. */
  async list(now = Date.now()): Promise<LiveHealthRecord[]> {
    const rows = await getAll<LiveHealthRecord>(STORE.liveHealth);
    const live = rows.filter((row) => now - row.at <= LIVE_HEALTH_TTL_MS);
    const expired = rows.length - live.length;
    if (expired > 0) {
      // Opportunistic: a rewrite is only paid for when something actually aged
      // out, and it keeps the table from growing for playlists long since gone.
      await liveHealthRepo.removeMany(
        rows.filter((row) => now - row.at > LIVE_HEALTH_TTL_MS).map((row) => row.contentId),
      );
    }
    return live.sort((a, b) => b.at - a.at);
  },

  async listForPlaylist(playlistId: string): Promise<LiveHealthRecord[]> {
    const rows = await getAllByIndex<LiveHealthRecord>(
      STORE.liveHealth,
      'playlistId',
      IDBKeyRange.only(playlistId),
    );
    const now = Date.now();
    return rows.filter((row) => now - row.at <= LIVE_HEALTH_TTL_MS).sort((a, b) => b.at - a.at);
  },

  /**
   * Merge a new failure into any existing record.
   *
   * Read-then-write rather than a blind put, because `attempts` is cumulative
   * and a concurrent write would otherwise reset the count to 1 and keep a
   * permanently broken channel visible forever.
   */
  async recordFailure(
    item: ContentItem,
    error: PlayerErrorInfo,
    now = Date.now(),
  ): Promise<LiveHealthRecord> {
    const previous = await get<LiveHealthRecord>(STORE.liveHealth, item.id);
    // Attempts older than the TTL are treated as a fresh start: a channel that
    // broke last week and broke again now is not "the same" evidence twice.
    const withinTtl = previous !== undefined && now - previous.at <= LIVE_HEALTH_TTL_MS;
    const record: LiveHealthRecord = {
      contentId: item.id,
      playlistId: item.playlistId,
      name: item.name,
      logo: item.logo,
      group: item.group,
      attempts: (withinTtl ? previous.attempts : 0) + 1,
      unrecoverable: (withinTtl ? previous.unrecoverable : false) || !error.recoverable,
      detail: error.detail ?? error.message,
      at: now,
    };
    await put(STORE.liveHealth, record);
    return record;
  },

  /** A channel that plays is not a problem, whatever it did last time. */
  async clear(contentId: string): Promise<void> {
    await del(STORE.liveHealth, contentId);
  },

  async removeMany(contentIds: string[]): Promise<void> {
    if (contentIds.length === 0) return;
    const { openDb, txDone } = await import('./db');
    const db = await openDb();
    const tx = db.transaction(STORE.liveHealth, 'readwrite');
    const store = tx.objectStore(STORE.liveHealth);
    for (const id of contentIds) store.delete(id);
    await txDone(tx);
  },

  /** Used by the Live TV "show hidden channels" action, and on refresh. */
  async clearForPlaylist(playlistId: string): Promise<void> {
    const rows = await getAllByIndex<LiveHealthRecord>(
      STORE.liveHealth,
      'playlistId',
      IDBKeyRange.only(playlistId),
    );
    await liveHealthRepo.removeMany(rows.map((row) => row.contentId));
  },
};

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

export interface IntroTimestampsRecord {
  contentId: string;
  playlistId: string;
  name: string;
  logo: string;
  kind: ContentItem['kind'];
  group: string;
  seriesId?: string;
  season?: number;
  episode?: number;
  introStart: number; // seconds
  introEnd: number;   // seconds
  updatedAt: number;
}

export const introTimestampsRepo = {
  async get(contentId: string): Promise<IntroTimestampsRecord | undefined> {
    return get<IntroTimestampsRecord>(STORE.introTimestamps, contentId);
  },

  async save(
    item: ContentItem,
    introStart: number,
    introEnd: number,
    now = Date.now()
  ): Promise<IntroTimestampsRecord> {
    const record: IntroTimestampsRecord = {
      contentId: item.id,
      playlistId: item.playlistId,
      name: item.name,
      logo: item.logo,
      kind: item.kind,
      group: item.group,
      seriesId: item.seriesId,
      season: item.season,
      episode: item.episode,
      introStart: Math.max(0, Math.floor(introStart)),
      introEnd: Math.max(0, Math.floor(introEnd)),
      updatedAt: now,
    };
    await put(STORE.introTimestamps, record);
    return record;
  },

  async remove(contentId: string): Promise<void> {
    await del(STORE.introTimestamps, contentId);
  },

  async listForPlaylist(playlistId: string): Promise<IntroTimestampsRecord[]> {
    return getAllByIndex<IntroTimestampsRecord>(
      STORE.introTimestamps,
      'playlistId',
      IDBKeyRange.only(playlistId),
    );
  },

  async removeMany(contentIds: string[]): Promise<void> {
    if (contentIds.length === 0) return;
    const { openDb, txDone } = await import('./db');
    const db = await openDb();
    const tx = db.transaction(STORE.introTimestamps, 'readwrite');
    const store = tx.objectStore(STORE.introTimestamps);
    for (const id of contentIds) store.delete(id);
    await txDone(tx);
  },
};

export async function wipeUserData(): Promise<void> {
  const [progress, health, intros] = await Promise.all([
    progressRepo.list(),
    liveHealthRepo.list(),
    introTimestampsRepo.listForPlaylist('').catch(() => []),
  ]);
  await Promise.all([
    progressRepo.removeMany(progress.map((p) => p.contentId)),
    recentRepo.clear(),
    liveHealthRepo.removeMany(health.map((h) => h.contentId)),
    introTimestampsRepo.removeMany(intros.map((i) => i.contentId)).catch(() => undefined),
  ]);
  const { clearStore } = await import('./db');
  await clearStore(STORE.favorites);
}
