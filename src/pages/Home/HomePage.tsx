/**
 * Home.
 *
 * This is the heaviest screen in the app, so it is built as a fixed set of
 * bounded rows rather than one giant list:
 *
 *   1. A hero for the single most relevant item (in-progress, else newest).
 *   2. Continue Watching — only items with a real resume position.
 *   3. My List.
 *   4. One row per content kind, capped.
 *
 * Caps matter: rendering "recently added" for 100,000 entries would build a
 * 100,000-element array on every store update. Every row here is `slice`d to a
 * fixed budget, so the cost of Home is constant regardless of playlist size.
 */
import { useCallback, useMemo, useRef } from 'react';
import { Hero } from '@/components/cards/Hero';
import { ContentRow, RowShell } from '@/components/cards/ContentRow';
import { LARGE_CARD_WIDTH } from '@/components/cards/ContentCard';
import { SeriesCard } from '@/components/cards/SeriesCard';
import { PageEnd } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/common/States';
import { ButtonLink } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { useDpadNavigation } from '@/hooks/useDpadNavigation';
import {
  getHiddenChannelIds,
  getItemBuckets,
  toggleFavorite,
  useAppSelector,
} from '@/store/appStore';
import { formatCount } from '@/utils/format';
import { ROUTES } from '@/utils/routes';
import type { ContentItem, SeriesGroup } from '@/types';

/** Per-row budget. Raising this is the only way Home gets slower. */
const ROW_LIMIT = 24;
const SERIES_LIMIT = 18;

/**
 * Entrance order. Rows are conditional, so a row that is hidden simply leaves a
 * gap in the sequence — `RowShell` caps the delay, so the cascade stays short
 * however the buckets happen to be filled.
 */
const ENTRY = {
  continueWatching: 0,
  favorites: 1,
  recent: 2,
  series: 3,
  movies: 4,
  live: 5,
  episodes: 6,
} as const;



export default function HomePage() {
  const items = useAppSelector((s) => s.items);
  const itemById = useAppSelector((s) => s.itemById);
  const playlists = useAppSelector((s) => s.playlists);
  const activePlaylistId = useAppSelector((s) => s.activePlaylistId);
  const progressById = useAppSelector((s) => s.progressById);
  const favoriteIds = useAppSelector((s) => s.favoriteIds);
  const recents = useAppSelector((s) => s.recents);
  const seriesIndex = useAppSelector((s) => s.seriesIndex);
  const liveFailures = useAppSelector((s) => s.liveFailures);
  const rootRef = useRef<HTMLDivElement>(null);

  useDpadNavigation(rootRef, { loop: false });

  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) ?? null,
    [playlists, activePlaylistId],
  );

  // Buckets are memoised on the `items` identity, so this is free on re-render.
  const buckets = useMemo(() => getItemBuckets(), [items]);

  // Channels known to be dead. The live row is a fixed slice of the bucket, so
  // without this the first few slots — and the hero, which prefers a live
  // channel — stay occupied by channels that cannot play.
  const hiddenIds = useMemo(() => getHiddenChannelIds(), [liveFailures]);
  const live = useMemo(
    () => (hiddenIds.size === 0 ? buckets.live : buckets.live.filter((i) => !hiddenIds.has(i.id))),
    [buckets.live, hiddenIds],
  );

  const continueWatching = useMemo(() => {
    const resume: ContentItem[] = [];
    for (const entry of progressById.values()) {
      // Only genuine resume points: started, and not effectively finished.
      if (entry.percent <= 0.01 || entry.percent >= 0.97) continue;
      const item = itemById.get(entry.contentId);
      if (item) resume.push(item);
      if (resume.length >= ROW_LIMIT) break;
    }
    return resume.sort(
      (a, b) =>
        (progressById.get(b.id)?.updatedAt ?? 0) - (progressById.get(a.id)?.updatedAt ?? 0),
    );
  }, [progressById, itemById]);

  const favorites = useMemo(() => {
    const list: ContentItem[] = [];
    for (let i = 0; i < items.length && list.length < ROW_LIMIT; i++) {
      if (favoriteIds.has(items[i].id)) list.push(items[i]);
    }
    return list;
  }, [items, favoriteIds]);

  const recent = useMemo(() => {
    const list: ContentItem[] = [];
    for (const record of recents) {
      if (list.length >= ROW_LIMIT) break;
      const item = itemById.get(record.contentId);
      if (item) list.push(item);
    }
    return list;
  }, [recents, itemById]);

  const onToggleFavorite = useCallback((item: ContentItem) => toggleFavorite(item), []);

  // Declared above the empty-playlist early return: these are hooks, and the
  // hook order must not depend on how much data the playlist happens to hold.
  const series = seriesIndex.groups.slice(0, SERIES_LIMIT);

  // One stable function for the whole row, so the Series cards only re-render
  // when the row's contents change. `SeriesCard` has no width of its own, so it
  // takes the row card width from the same table `ContentCard` uses — otherwise
  // this row would be the one card size on the page that did not change.
  const renderSeries = useCallback(
    (entry: SeriesGroup, index: number) => (
      <SeriesCard series={entry} index={index} total={series.length} large />
    ),
    [series.length],
  );

  // The hero picks the most relevant single item: whatever is mid-playback wins,
  // then the most recent live channel, then the first movie.
  const hero = useMemo(() => {
    if (continueWatching[0]) return { item: continueWatching[0], resume: true };
    if (live[0]) return { item: live[0], resume: false };
    if (buckets.movie[0]) return { item: buckets.movie[0], resume: false };
    // Last resort, and the one case where a hidden channel can still be reached:
    // a playlist of nothing but live entries, all of them dead. Scans for the
    // first entry that is actually playable and stops there.
    for (let i = 0; i < items.length; i++) {
      if (!hiddenIds.has(items[i].id)) return { item: items[i], resume: false };
    }
    return null;
  }, [continueWatching, live, buckets, items, hiddenIds]);

  

  if (items.length === 0) {
    return (
      <div ref={rootRef} className="flex min-h-[60vh] flex-col items-center justify-center px-4">
        <div className="animate-rise w-full max-w-md text-center">
          <div className="mx-auto flex h-18 w-18 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500/15 to-accent-700/15 border border-accent-500/20">
            <Icon name="layers" size={36} className="text-accent-400" />
          </div>
          <EmptyState
            icon="layers"
            title={playlists.length === 0 ? 'No playlist yet' : 'This playlist is empty'}
            message={
              playlists.length === 0
                ? 'Add an M3U or M3U8 playlist URL to get started. Everything is stored on this device.'
                : 'The active playlist parsed successfully but contained no entries.'
            }
            action={
              playlists.length === 0 ? (
                <ButtonLink to={ROUTES.playlists} icon="plus" shimmer size="lg">
                  Add a playlist
                </ButtonLink>
              ) : (
                <ButtonLink to={ROUTES.playlists} variant="secondary" icon="refresh" size="lg">
                  Switch playlist
                </ButtonLink>
              )
            }
          />
          <PageEnd />
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef}>
      {/* Hero Section */}
      <section className="relative -mx-4 mb-6 md:mx-0" aria-label="Featured">
        {hero ? (
          <Hero
            item={hero.item}
            progress={progressById.get(hero.item.id)}
            resume={hero.resume}
            favorite={favoriteIds.has(hero.item.id)}
            onToggleFavorite={onToggleFavorite}
          />
        ) : null}
      </section>

      {/* Continue Watching */}
      {continueWatching.length > 0 ? (
        <ContentRow
          title="Continue watching"
          icon="clock"
          count={continueWatching.length}
          large
          staggerIndex={ENTRY.continueWatching}
          items={continueWatching}
          progressById={progressById}
          favoriteIds={favoriteIds}
          onToggleFavorite={onToggleFavorite}
        />
      ) : null}

      {/* My List */}
      {favorites.length > 0 ? (
        <ContentRow
          title="My List"
          icon="list"
          count={favorites.length}
          large
          staggerIndex={ENTRY.favorites}
          items={favorites}
          href={ROUTES.myList}
          progressById={progressById}
          favoriteIds={favoriteIds}
          onToggleFavorite={onToggleFavorite}
        />
      ) : null}

      {/* Recently Watched (only if no continue watching) */}
      {recent.length > 0 && continueWatching.length === 0 ? (
        <ContentRow
          title="Recently watched"
          icon="clock"
          count={recent.length}
          large
          staggerIndex={ENTRY.recent}
          items={recent}
          progressById={progressById}
          favoriteIds={favoriteIds}
          onToggleFavorite={onToggleFavorite}
        />
      ) : null}

      {/* Series */}
      {series.length > 0 ? (
        <RowShell
          title="Series"
          icon="layers"
          count={seriesIndex.groups.length}
          staggerIndex={ENTRY.series}
          items={series}
          href={ROUTES.series}
          renderItem={renderSeries}
        />
      ) : null}

      {/* Movies */}
      {buckets.movie.length > 0 ? (
        <ContentRow
          title="Movies"
          icon="film"
          count={buckets.movie.length}
          large
          staggerIndex={ENTRY.movies}
          items={buckets.movie.slice(0, ROW_LIMIT)}
          href={ROUTES.movies}
          progressById={progressById}
          favoriteIds={favoriteIds}
          onToggleFavorite={onToggleFavorite}
        />
      ) : null}

      {/* Live TV */}
      {live.length > 0 ? (
        <ContentRow
          title="Live channels"
          icon="tv"
          count={live.length}
          large
          staggerIndex={ENTRY.live}
          items={live.slice(0, ROW_LIMIT)}
          variant="channel"
          href={ROUTES.live}
          progressById={progressById}
          favoriteIds={favoriteIds}
          onToggleFavorite={onToggleFavorite}
        />
      ) : null}

      {/* Episodes (fallback when no series groups) */}
      {buckets.series.length > 0 && series.length === 0 ? (
        <ContentRow
          title="Episodes"
          icon="film"
          count={buckets.series.length}
          large
          staggerIndex={ENTRY.episodes}
          items={buckets.series.slice(0, ROW_LIMIT)}
          href={ROUTES.series}
          progressById={progressById}
          favoriteIds={favoriteIds}
          onToggleFavorite={onToggleFavorite}
        />
      ) : null}

      {/* Playlist footer */}
      {activePlaylist ? (
        <div className="animate-rise mt-8 px-4 md:px-8" style={{ animationDelay: '200ms' }}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-4 rounded-xl bg-gradient-to-r from-ink-900/60 to-ink-850/60 border border-white/5 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-500/15 text-accent-400">
                <Icon name="playlist" size={18} />
              </div>
              <div>
                <p className="text-sm font-medium text-mist-50">{formatCount(activePlaylist.itemCount)} items</p>
                <p className="text-[11px] text-mist-500">
                  {activePlaylist.lastUpdated
                    ? `Updated ${new Date(activePlaylist.lastUpdated).toLocaleDateString()}`
                    : 'Never refreshed'}
                </p>
              </div>
            </div>
            <ButtonLink
              to={ROUTES.playlists}
              variant="ghost"
              size="sm"
              icon="settings"
            >
              Manage playlists
            </ButtonLink>
          </div>
        </div>
      ) : null}

      <PageEnd />
    </div>
  );
}