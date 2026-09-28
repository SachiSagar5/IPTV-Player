/**
 * The single application store.
 *
 * Everything above this line is a service; everything below is a component.
 * No component calls the playlist pipeline, IndexedDB, or the player engine
 * directly — they read derived state from here and call intent methods.
 *
 * Performance rules encoded in this file:
 *  - `items`, `searchIndex` and `seriesIndex` are swapped atomically, so a
 *    playlist switch is a single notification rather than N cascading renders.
 *  - Derived collections (rows, filters) are memoised per input identity, so
 *    scrolling or hovering never rebuilds an array.
 *  - Player state lives in a **separate** store so `timeupdate` ticks (4/s) can
 *    never re-render the browse pages.
 */
import { Store, useStoreSelector } from './store';
import type {
  AppSettings,
  ContentItem,
  ContentKind,
  ParseProgress,
  PlaybackProgress,
  PlaylistMeta,
  SeriesIndex,
} from '@/types';
import { EMPTY_SERIES_INDEX, buildSeriesIndex } from '@/services/m3u/seriesIndex';
import { emptyCounts } from '@/services/storage/playlistRepo';
import { SearchIndex, buildCompactSearchIndex } from '@/utils/searchIndex';
import {
  DEFAULT_SETTINGS,
  loadActivePlaylistId,
  loadOnboardingDone,
  loadSettings,
  saveActivePlaylistId,
  saveOnboardingDone,
  saveSettings,
} from '@/services/storage/prefs';
import { playlistsRepo } from '@/services/storage/playlistRepo';
import { favoritesRepo, liveHealthRepo, progressRepo, recentRepo } from '@/services/storage/userDataRepo';
import type { FavoriteRecord, LiveHealthRecord, RecentRecord } from '@/services/storage/userDataRepo';
import { isHiddenChannel } from '@/services/storage/userDataRepo';
import type { PlayerErrorInfo } from './playerStore';
import { describeError } from '@/services/m3u/fetcher';
import { isAdultItem, pickParentPlaylistId } from '@/services/m3u/adult';
import { loadPlaylistFromUrl } from '@/services/m3u/playlistService';

export interface AppState {
  /** True once IndexedDB hydration finished (or failed). */
  hydrated: boolean;
  hydrationError: string | null;

  playlists: PlaylistMeta[];
  activePlaylistId: string | null;

  /**
   * The predominantly-adult playlist, reserved for the Parent page. It is never
   * activated for ordinary browsing, so `items` never contains its entries.
   */
  parentPlaylistId: string | null;
  /** Entries of `parentPlaylistId`, loaded separately from the active playlist. */
  parentItems: ContentItem[];
  /**
   * Lookup for `parentItems`, kept apart from `itemById` so the ordinary pages
   * can tell which playlist an entry came from. The watch route is shared by
   * both, so it consults both.
   */
  parentItemById: Map<string, ContentItem>;
  /** Search index over `parentItems`, so a title there is findable when unlocked. */
  parentSearchIndex: SearchIndex | null;
  /** Series index over `parentItems`, for episodes in the reserved playlist. */
  parentSeriesIndex: SeriesIndex;

  /** Entries of the active playlist. Replaced atomically. */
  items: ContentItem[];
  itemById: Map<string, ContentItem>;
  searchIndex: SearchIndex | null;
  seriesIndex: SeriesIndex;

  /** In-flight add/refresh state. */
  busy: { playlistId: string | null; name: string; progress: ParseProgress | null } | null;

  favorites: FavoriteRecord[];
  favoriteIds: ReadonlySet<string>;
  progressById: Map<string, PlaybackProgress>;
  recents: RecentRecord[];

  /**
   * Live channels that failed to play, keyed by content id.
   *
   * Lives here rather than in `playerStore` because the consequence is a browse
   * decision, not a playback one: the Live TV surfaces read this to withhold
   * broken channels, and re-rendering them on the player's 4/s tick is exactly
   * what the split store exists to prevent.
   */
  liveFailures: ReadonlyMap<string, LiveHealthRecord>;

  settings: AppSettings;
  onboardingDone: boolean;

  /** Last top-level error, surfaced as a dismissible banner. */
  error: { message: string; id: number } | null;
}

const initialState: AppState = {
  hydrated: false,
  hydrationError: null,
  playlists: [],
  activePlaylistId: null,
  parentPlaylistId: null,
  parentItems: [],
  parentItemById: new Map(),
  parentSearchIndex: null,
  parentSeriesIndex: EMPTY_SERIES_INDEX,
  items: [],
  itemById: new Map(),
  searchIndex: null,
  seriesIndex: EMPTY_SERIES_INDEX,
  busy: null,
  favorites: [],
  favoriteIds: new Set(),
  progressById: new Map(),
  recents: [],
  liveFailures: new Map(),
  settings: DEFAULT_SETTINGS,
  onboardingDone: false,
  error: null,
};

export const appStore = new Store<AppState>({
  ...initialState,
  settings: loadSettings(),
  onboardingDone: loadOnboardingDone(),
});

let errorSeq = 0;

function pushError(message: string): void {
  errorSeq += 1;
  appStore.patch({ error: { message, id: errorSeq } });
}

export function dismissError(): void {
  appStore.patch({ error: null });
}

/* ------------------------------------------------------------------ *
 * Derived collections (memoised outside the store so identity is stable)
 * ------------------------------------------------------------------ */

export interface ItemBuckets {
  live: ContentItem[];
  movie: ContentItem[];
  series: ContentItem[];
  other: ContentItem[];
  all: ContentItem[];
}

// `gated` is part of the key: the same `items` array buckets differently once
// parental controls are switched on, so keying on identity alone would serve a
// stale split straight after the toggle.
let bucketCache: { source: ContentItem[]; gated: boolean; value: ItemBuckets } | null = null;

export function getItemBuckets(): ItemBuckets {
  const items = appStore.getState().items;
  const gated = appStore.getState().settings.parentControls;
  if (bucketCache && bucketCache.source === items && bucketCache.gated === gated) {
    return bucketCache.value;
  }

  const live: ContentItem[] = [];
  const movie: ContentItem[] = [];
  const series: ContentItem[] = [];
  const other: ContentItem[] = [];
  // `all` has to be the *visible* list, not `items`. It is currently unused, but a
  // field named `all` that quietly ignores the gate is exactly the sort of thing
  // a future caller reaches for and leaks adult titles through.
  const visible: ContentItem[] = [];

  // With parental controls on, adult entries are withheld from every ordinary
  // surface. The Parent page bypasses these buckets entirely: it reads
  // `parentItems` for a reserved playlist, or scans `items` itself for a mixed
  // one, so it still sees what is withheld here.
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (gated && isAdultItem(item)) continue;
    visible.push(item);
    switch (item.kind) {
      case 'live':
        live.push(item);
        break;
      case 'movie':
        movie.push(item);
        break;
      case 'series':
        series.push(item);
        break;
      default:
        other.push(item);
    }
  }

  const value: ItemBuckets = { live, movie, series, other, all: visible };
  bucketCache = { source: items, gated, value };
  return value;
}

export interface FilterFacets {
  groups: string[];
  languages: string[];
  countries: string[];
}

let facetCache: {
  source: ContentItem[];
  key: string;
  gated: boolean;
  value: FilterFacets;
} | null = null;

/**
 * Facets are capped: some providers ship 4,000 distinct `group-title` values,
 * and rendering 4,000 filter chips is worse than useless. The top N by
 * frequency are kept, which is what a user actually scrolls to.
 */
const MAX_FACETS = 60;

function firstToken(raw: string): string {
  return raw.split(/[,/|;]/)[0].trim();
}

export function getFacets(kind?: ContentItem['kind']): FilterFacets {
  const items = appStore.getState().items;
  const key = kind ? `${kind}` : 'all';
  const gated = appStore.getState().settings.parentControls;
  if (
    facetCache &&
    facetCache.source === items &&
    facetCache.key === key &&
    facetCache.gated === gated
  ) {
    return facetCache.value;
  }

  const groupCounts = new Map<string, number>();
  const languageCounts = new Map<string, number>();
  const countryCounts = new Map<string, number>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (kind && item.kind !== kind) continue;
    if (gated && isAdultItem(item)) continue;
    if (item.group) groupCounts.set(item.group, (groupCounts.get(item.group) ?? 0) + 1);
    const lang = item.language ? firstToken(item.language) : '';
    if (lang) languageCounts.set(lang, (languageCounts.get(lang) ?? 0) + 1);
    if (item.country) {
      const c = item.country.slice(0, 2).toUpperCase();
      countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
    }
  }

  const top = (counts: Map<string, number>): string[] =>
    Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_FACETS)
      .map(([key]) => key);

  const value: FilterFacets = {
    groups: top(groupCounts),
    languages: top(languageCounts),
    countries: top(countryCounts),
  };
  facetCache = { source: items, key, gated, value };
  return value;
}

/* ------------------------------------------------------------------ *
 * Hydration
 * ------------------------------------------------------------------ */

export async function hydrate(): Promise<void> {
  try {
    const [playlists, favorites, progress, recents, liveFailures] = await Promise.all([
      playlistsRepo.list(),
      favoritesRepo.list(),
      progressRepo.list(),
      recentRepo.list(),
      // Absorbs the failure, so a stream-health problem can never keep the whole
      // app from booting — worst case the channels are simply all visible again.
      liveHealthRepo.list().catch((): LiveHealthRecord[] => []),
    ]);

    const favoriteIds = new Set(favorites.map((f) => f.contentId));
    const progressById = new Map(progress.map((p) => [p.contentId, p]));

    // Reserve the predominantly-adult playlist first, so the choice below can
    // never land on it.
    const parentPlaylistId = pickParentPlaylistId(playlists);
    const isParent = (meta: PlaylistMeta): boolean => meta.id === parentPlaylistId;

    const requested = loadActivePlaylistId();
    const active =
      requested && playlists.some((p) => p.id === requested && !isParent(p)) ? requested : null;
    const fallback = playlists.find((p) => p.status === 'ready' && !isParent(p))?.id ?? null;
    const activePlaylistId = active ?? fallback;

    appStore.patch({
      hydrated: true,
      playlists,
      favorites,
      favoriteIds,
      progressById,
      recents,
      activePlaylistId,
      parentPlaylistId,
      liveFailures: new Map(liveFailures.map((row) => [row.contentId, row])),
    });

    if (parentPlaylistId) {
      await loadParentPlaylist(parentPlaylistId);
    }
    if (activePlaylistId) {
      await activatePlaylist(activePlaylistId);
    }
  } catch (error) {
    appStore.patch({
      hydrated: true,
      hydrationError: describeError(error),
    });
  }
}

/* ------------------------------------------------------------------ *
 * Playlist lifecycle
 * ------------------------------------------------------------------ */

let activeLoadToken = 0;
let parentLoadToken = 0;

/**
 * Loads the reserved Parent playlist's entries and search index.
 *
 * Kept out of `items` on purpose: the ordinary pages read `items`, so reserving
 * the playlist here is what keeps its entries out of Movies, Series, Live, Home
 * and My List without any per-entry filtering on those pages.
 */
export async function loadParentPlaylist(playlistId: string | null): Promise<void> {
  const token = ++parentLoadToken;
  if (!playlistId) {
    appStore.patch({
      parentPlaylistId: null,
      parentItems: [],
      parentItemById: new Map(),
      parentSearchIndex: null,
      parentSeriesIndex: EMPTY_SERIES_INDEX,
    });
    return;
  }
  try {
    const items = await playlistsRepo.loadItems(playlistId);
    if (token !== parentLoadToken) return;
    appStore.patch({
      parentPlaylistId: playlistId,
      parentItems: items,
      parentItemById: new Map(items.map((item) => [item.id, item])),
      parentSearchIndex: getOrCreateSearchIndex(playlistId, items),
      parentSeriesIndex: buildSeriesIndex(items),
    });
  } catch (error) {
    if (token !== parentLoadToken) return;
    // A Parent list that will not load must not take the app down with it, and it
    // must not masquerade as an empty one either: clearing the id lets the
    // playlist fall back to ordinary browsing, where a broken load is reported
    // the same way as any other.
    pushError(`Could not load the Parent playlist. ${describeError(error)}`);
    appStore.patch({
      parentPlaylistId: null,
      parentItems: [],
      parentItemById: new Map(),
      parentSearchIndex: null,
      parentSeriesIndex: EMPTY_SERIES_INDEX,
    });
  }
}

/**
 * Compact search indexes are kept per playlist for the session.
 * The index is intentionally not persisted: it is ~2 MB per 100k entries and
 * rebuilding it on demand is cheaper than storing and invalidating it. Keeping
 * it in memory means switching back to a previously loaded playlist is instant.
 */
const searchIndexCache = new Map<string, { compactItems: ContentItem[]; index: SearchIndex }>();

function getOrCreateSearchIndex(
  playlistId: string,
  items: ContentItem[],
): SearchIndex {
  const cached = searchIndexCache.get(playlistId);
  if (cached && cached.compactItems === items) return cached.index;
  const index = new SearchIndex(buildCompactSearchIndex(items), items);
  searchIndexCache.set(playlistId, { compactItems: items, index });
  return index;
}

export async function activatePlaylist(playlistId: string | null): Promise<void> {
  // The Parent playlist is not browsable, so refuse to activate it. Silently
  // ignoring rather than throwing: the caller is usually a click handler that
  // has nothing useful to do about it.
  if (playlistId !== null && playlistId === appStore.getState().parentPlaylistId) return;

  const token = ++activeLoadToken;
  if (!playlistId) {
    resetActivePlaylist();
    saveActivePlaylistId(null);
    return;
  }

  appStore.patch({ activePlaylistId: playlistId });
  saveActivePlaylistId(playlistId);

  try {
    const items = await playlistsRepo.loadItems(playlistId);
    if (token !== activeLoadToken) return;

    const [meta, searchIndex, seriesIndex] = [
      await playlistsRepo.get(playlistId),
      getOrCreateSearchIndex(playlistId, items),
      buildSeriesIndex(items),
    ];

    if (token !== activeLoadToken) return;

    applyActivePlaylist({ items, searchIndex, seriesIndex, meta: meta ?? undefined });
  } catch (error) {
    if (token !== activeLoadToken) return;
    pushError(`Could not load the saved playlist. ${describeError(error)}`);
  }
}

function applyActivePlaylist(input: {
  items: ContentItem[];
  searchIndex: SearchIndex | null;
  seriesIndex: SeriesIndex;
  meta?: PlaylistMeta;
}): void {
  const itemById = new Map<string, ContentItem>();
  const { items } = input;
  for (let i = 0; i < items.length; i++) itemById.set(items[i].id, items[i]);

  appStore.patch({
    items,
    itemById,
    searchIndex: input.searchIndex,
    seriesIndex: input.seriesIndex,
    playlists: input.meta
      ? appStore.getState().playlists.map((p) => (p.id === input.meta!.id ? input.meta! : p))
      : appStore.getState().playlists,
  });
}

function resetActivePlaylist(): void {
  applyActivePlaylist({ items: [], searchIndex: null, seriesIndex: EMPTY_SERIES_INDEX });
}

/**
 * Re-derives which playlist is reserved for the Parent page, and loads it.
 *
 * A playlist can cross the majority threshold in either direction: a refresh
 * that re-parses a source can turn an ordinary list into an adult one, and
 * deleting the reserved list frees the next candidate. Callers run this after
 * any change to `playlists` rather than assuming the id is stable.
 */
export async function reconcileParentPlaylist(): Promise<void> {
  const { playlists, parentPlaylistId, activePlaylistId } = appStore.getState();
  const nextId = pickParentPlaylistId(playlists);
  if (nextId === parentPlaylistId) return;

  // If the playlist being browsed has just become the Parent list, move off it
  // first: the active list still holds its entries at this point, and leaving the
  // user on a playlist whose entries are about to be hidden would look like the
  // app emptied itself out.
  if (activePlaylistId !== null && activePlaylistId === nextId) {
    const fallback =
      playlists.find((p) => p.id !== nextId && p.status === 'ready')?.id ?? null;
    await activatePlaylist(fallback);
  }

  await loadParentPlaylist(nextId);
}

export async function addPlaylist(input: {
  name: string;
  url: string;
}): Promise<boolean> {
  const name = input.name.trim() || 'My Playlist';
  setBusy({ playlistId: null, name, progress: null });
  try {
    const loaded = await loadPlaylistFromUrl({
      name,
      url: input.url,
      onProgress: (progress) => setBusy({ playlistId: null, name, progress }),
    });
    appStore.patch((state) => ({
      playlists: [...state.playlists, loaded.meta],
    }));
    await reconcileParentPlaylist();
    await activatePlaylist(loaded.meta.id);
    return true;
  } catch (error) {
    pushError(describeError(error));
    return false;
  } finally {
    setBusy(null);
  }
}

export async function refreshPlaylist(playlistId: string): Promise<boolean> {
  const meta = appStore.getState().playlists.find((p) => p.id === playlistId);
  if (!meta) return false;
  if (appStore.getState().busy) return false;

  setBusy({ playlistId, name: meta.name, progress: null });
  try {
    const cached = searchIndexCache.get(playlistId);
    const loaded = await loadPlaylistFromUrl({
      name: meta.name,
      url: meta.url,
      meta,
      previousItems: cached?.compactItems,
      onProgress: (progress) => setBusy({ playlistId, name: meta.name, progress }),
    });

    appStore.patch((state) => ({
      playlists: state.playlists.map((p) => (p.id === playlistId ? loaded.meta : p)),
    }));
    await reconcileParentPlaylist();

    if (loaded.unchanged) {
      // No parse ran: the entries and the search index already in memory are
      // still correct, so there is nothing to swap into the store. Only the
      // `lastUpdated` timestamp above changed.
      return true;
    }

    if (!loaded.searchIndex) return true;

    searchIndexCache.set(playlistId, {
      compactItems: loaded.items,
      index: loaded.searchIndex,
    });

    if (appStore.getState().activePlaylistId === playlistId) {
      applyActivePlaylist({
        items: loaded.items,
        searchIndex: loaded.searchIndex,
        seriesIndex: buildSeriesIndex(loaded.items),
      });
    }
    return true;
  } catch (error) {
    pushError(describeError(error));
    return false;
  } finally {
    setBusy(null);
  }
}

export function renamePlaylist(playlistId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  appStore.patch((state) => ({
    playlists: state.playlists.map((p) => (p.id === playlistId ? { ...p, name: trimmed } : p)),
  }));
  const meta = appStore.getState().playlists.find((p) => p.id === playlistId);
  if (meta) void playlistsRepo.save(meta);
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  const remaining = appStore
    .getState()
    .playlists.filter((p) => p.id !== playlistId)
    .sort((a, b) => a.createdAt - b.createdAt);
  appStore.patch({ playlists: remaining });

  try {
    await playlistsRepo.remove(playlistId);
  } catch (error) {
    pushError(`Could not delete the playlist. ${describeError(error)}`);
    return;
  }

  if (appStore.getState().activePlaylistId === playlistId) {
    await activatePlaylist(remaining[0]?.id ?? null);
  }
  await reconcileParentPlaylist();
}

export function setDefaultPlaylist(playlistId: string): void {
  saveActivePlaylistId(playlistId);
  if (appStore.getState().activePlaylistId !== playlistId) void activatePlaylist(playlistId);
}

function setBusy(busy: AppState['busy']): void {
  appStore.patch({ busy });
}

/* ------------------------------------------------------------------ *
 * Favourites / progress / recents
 * ------------------------------------------------------------------ */

export function isFavorite(contentId: string): boolean {
  return appStore.getState().favoriteIds.has(contentId);
}

export function toggleFavorite(item: ContentItem): void {
  const isFav = appStore.getState().favoriteIds.has(item.id);
  if (isFav) {
    appStore.patch((state) => {
      const favoriteIds = new Set(state.favoriteIds);
      favoriteIds.delete(item.id);
      return {
        favorites: state.favorites.filter((f) => f.contentId !== item.id),
        favoriteIds,
      };
    });
    void favoritesRepo.remove(item.id);
    return;
  }

  const now = Date.now();
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
  appStore.patch((state) => {
    const favoriteIds = new Set(state.favoriteIds);
    favoriteIds.add(item.id);
    return { favorites: [record, ...state.favorites], favoriteIds };
  });
  void favoritesRepo.add(item, now);
}

export function getProgress(contentId: string): PlaybackProgress | undefined {
  return appStore.getState().progressById.get(contentId);
}

export async function saveProgress(
  item: ContentItem,
  position: number,
  duration: number,
  watchedSec: number,
): Promise<void> {
  if (item.kind === 'live') return;
  try {
    const saved = await progressRepo.save(item, position, duration, watchedSec);
    const existing = appStore.getState().progressById.get(item.id);
    if (saved) {
      if (!existing || existing.position !== saved.position || existing.duration !== saved.duration) {
        appStore.patch((state) => {
          const next = new Map(state.progressById);
          next.set(item.id, saved);
          return { progressById: next };
        });
      }
    } else if (existing) {
      appStore.patch((state) => {
        const next = new Map(state.progressById);
        next.delete(item.id);
        return { progressById: next };
      });
    }
  } catch {
    /* Progress is best-effort; never interrupt playback for a write failure. */
  }
}

export function clearProgress(contentId: string): void {
  appStore.patch((state) => {
    const next = new Map(state.progressById);
    next.delete(contentId);
    return { progressById: next };
  });
  void progressRepo.remove(contentId);
}

export function markWatched(item: ContentItem, label: string): void {
  void recentRepo.record(item, label);
  // Reflect immediately without waiting on the transaction.
  appStore.patch((state) => ({
    recents: [
      {
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
      },
      ...state.recents.filter((r) => r.contentId !== item.id),
    ].slice(0, 60),
  }));
}

/* ------------------------------------------------------------------ *
 * Live channel health
 *
 * A live channel that cannot play is worse than a missing one: the user spends
 * the click, the spinner and the error screen to learn nothing. So a channel
 * that fails is remembered and withheld from the Live TV surfaces.
 *
 * Two rules keep this from becoming a way to lose channels:
 *  - One failure is not a verdict. A transient network blip must not cost
 *    someone their news channel, so hiding needs a second failure — or a single
 *    failure the engine itself called unrecoverable.
 *  - Evidence expires, and can be cleared by hand. A provider outage must not
 *    permanently shrink someone's channel list, and hiding is never the only
 *    word: the Live TV page always offers to show them back.
 * ------------------------------------------------------------------ */

/**
 * Cached for one minute rather than forever.
 *
 * Expiry is time-based, so keying the cache purely on the map identity would
 * serve a stale answer for the rest of a long session; recomputing it on every
 * render would walk every recorded failure per card. A minute of staleness on
 * a 24-hour TTL is invisible.
 */
let hiddenCache: {
  source: ReadonlyMap<string, LiveHealthRecord>;
  bucket: number;
  value: ReadonlySet<string>;
} | null = null;

export function getHiddenChannelIds(): ReadonlySet<string> {
  const failures = appStore.getState().liveFailures;
  const bucket = Math.floor(Date.now() / 60_000);
  if (hiddenCache && hiddenCache.source === failures && hiddenCache.bucket === bucket) {
    return hiddenCache.value;
  }
  const now = Date.now();
  const value = new Set<string>();
  for (const [contentId, record] of failures) {
    if (isHiddenChannel(record, now)) value.add(contentId);
  }
  hiddenCache = { source: failures, bucket, value };
  return value;
}

/**
 * How many channels are being withheld from a playlist, for the notice that
 * explains the hiding. Not memoised: it walks only the recorded failures (a
 * handful, not a playlist) and the page calling it already walks the set.
 */
export function countHiddenChannels(playlistId: string | null): number {
  if (playlistId === null) return 0;
  const now = Date.now();
  let count = 0;
  for (const record of appStore.getState().liveFailures.values()) {
    if (record.playlistId === playlistId && isHiddenChannel(record, now)) count += 1;
  }
  return count;
}

/**
 * Record a failed stream and hide the channel if the evidence is conclusive.
 *
 * VOD is deliberately ignored: a film that fails to load is a different problem
 * (a bad file on a good connection) and hiding it would throw away the user's
 * library over a transient fault.
 */
export function noteStreamFailure(item: ContentItem, error: PlayerErrorInfo): void {
  if (item.kind !== 'live') return;
  void liveHealthRepo.recordFailure(item, error).then(
    (record) => {
      appStore.patch((state) => {
        const next = new Map(state.liveFailures);
        next.set(item.id, record);
        return { liveFailures: next };
      });
    },
    () => {
      /* Health tracking is best-effort; a failed write just means no hiding. */
    },
  );
}

/** A channel that starts playing is not a problem, whatever it did last time. */
export function clearStreamFailure(contentId: string): void {
  if (!appStore.getState().liveFailures.has(contentId)) return;
  appStore.patch((state) => {
    const next = new Map(state.liveFailures);
    next.delete(contentId);
    return { liveFailures: next };
  });
  void liveHealthRepo.clear(contentId);
}

/**
 * Forget every recorded failure for a playlist — the "show hidden channels"
 * action on the Live TV page.
 *
 * Records, not just the hidden ones: a channel that failed once is still on
 * probation, and un-hiding everything should give those a clean slate too.
 */
export function restoreHiddenChannels(playlistId: string | null): void {
  if (playlistId === null) return;
  appStore.patch((state) => {
    const next = new Map<string, LiveHealthRecord>();
    for (const [contentId, record] of state.liveFailures) {
      if (record.playlistId !== playlistId) next.set(contentId, record);
    }
    return { liveFailures: next };
  });
  void liveHealthRepo.clearForPlaylist(playlistId);
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export function updateSettings(patch: Partial<AppSettings>): void {
  const next = { ...appStore.getState().settings, ...patch };
  appStore.patch({ settings: next });
  saveSettings(next);
}

export function completeOnboarding(): void {
  saveOnboardingDone();
  appStore.patch({ onboardingDone: true });
}

/* ------------------------------------------------------------------ *
 * Item lookup
 * ------------------------------------------------------------------ */

export function getItem(contentId: string | undefined): ContentItem | undefined {
  if (!contentId) return undefined;
  const state = appStore.getState();
  // Both maps, because the watch route serves the ordinary pages and the Parent
  // section alike. An entry only ever lives in one of them.
  return state.itemById.get(contentId) ?? state.parentItemById.get(contentId);
}

/** True when the entry lives in the reserved Parent playlist rather than the active one. */
export function isParentItem(item: ContentItem): boolean {
  const state = appStore.getState();
  return state.parentPlaylistId !== null && item.playlistId === state.parentPlaylistId;
}

/** True when the active playlist has entries. */
export function hasContent(): boolean {
  return appStore.getState().items.length > 0;
}

/** Counts for the currently active playlist (zeroes when nothing is loaded). */
export function getActiveCounts(): Record<ContentKind, number> {
  const state = appStore.getState();
  const meta = state.playlists.find((p) => p.id === state.activePlaylistId);
  return meta?.counts ?? emptyCounts();
}

/** Counts across every saved playlist. Pure — safe to memoise in a component. */
export function aggregateCounts(
  playlists: readonly PlaylistMeta[],
): Record<ContentKind, number> {
  const totals = emptyCounts();
  for (const playlist of playlists) {
    totals.live += playlist.counts.live;
    totals.movie += playlist.counts.movie;
    totals.series += playlist.counts.series;
    totals.other += playlist.counts.other;
  }
  return totals;
}

/** Subscribe to a slice of application state. */
export function useAppSelector<T>(selector: (s: AppState) => T): T {
  return useStoreSelector(appStore, selector);
}

export type { Store };
