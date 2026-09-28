/**
 * Series detail: banner, season picker, episode list.
 *
 * The episode list is a list (not a grid) because episodes carry two extra data
 * points — the resume bar and the watched/unwatched state — and a list is the
 * only layout where those are readable at a glance. On a 10-foot UI the list is
 * also the cheapest thing to navigate with a D-pad.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageEnd } from '@/components/layout/PageHeader';
import { ButtonLink, IconButton } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { LazyImage } from '@/components/common/LazyImage';
import { EmptyState } from '@/components/common/States';
import { ContentCard } from '@/components/cards/ContentCard';
import { RatingBadge } from '@/components/common/RatingBadge';
import { useDpadNavigation } from '@/hooks/useDpadNavigation';
import { useItemRating } from '@/hooks/useRating';
import {
  clearProgress,
  isFavorite,
  saveProgress,
  toggleFavorite,
  useAppSelector,
} from '@/store/appStore';
import { cleanTitle } from '@/services/m3u/categorize';
import { formatDuration, formatTime } from '@/utils/format';
import { parseWatchParam, watchPath } from '@/utils/routes';
import type { ContentItem } from '@/types';

export default function SeriesDetailPage() {
  const { seriesId } = useParams();
  const decodedId = parseWatchParam(seriesId);
  const seriesIndex = useAppSelector((s) => s.seriesIndex);
  const progressById = useAppSelector((s) => s.progressById);
  const favoriteIds = useAppSelector((s) => s.favoriteIds);
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeSeason, setActiveSeason] = useState<number | null>(null);

  useDpadNavigation(rootRef, { loop: false });

  const series = decodedId ? seriesIndex.byId.get(decodedId) : undefined;

  const season = useMemo(() => {
    if (!series) return null;
    if (activeSeason != null) {
      const match = series.seasons.find((s) => s.season === activeSeason);
      if (match) return match;
    }
    // Default to the season with the most recent progress, else season 1.
    const withProgress = series.seasons.find((s) =>
      s.episodes.some((e) => (progressById.get(e.id)?.percent ?? 0) > 0.01),
    );
    return withProgress ?? series.seasons[0] ?? null;
  }, [series, activeSeason, progressById]);

  const onToggleFavorite = useCallback(
    (item: ContentItem) => toggleFavorite(item),
    [],
  );

  if (!series || !season) {
    return (
      <div ref={rootRef}>
        <EmptyState
          icon="layers"
          title="Series not found"
          message="It may belong to a different playlist, or the playlist has been refreshed since this link was created."
          action={
            <ButtonLink to="/series" variant="secondary" icon="arrow-left">
              All series
            </ButtonLink>
          }
        />
        <PageEnd />
      </div>
    );
  }

  const title = cleanTitle(series.name) || series.name;
  const favorite = favoriteIds.has(series.id);
  const seriesRating = useItemRating({ kind: 'series', title: series.name });
  const firstUnwatched =
    season.episodes.find((e) => (progressById.get(e.id)?.percent ?? 0) < 0.95) ??
    season.episodes[0];

  return (
    <div ref={rootRef}>
      {/* Banner */}
      <section className="relative isolate overflow-hidden">
        {series.logo ? (
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 scale-110 opacity-25 blur-2xl"
            style={{
              backgroundImage: `url("${encodeURI(series.logo)}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center 25%',
            }}
          />
        ) : null}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-t from-ink-950 via-ink-950/90 to-ink-950/50"
        />
        <div className="flex flex-col gap-5 px-4 pt-8 pb-6 sm:flex-row sm:items-end md:px-8">
          <Link
            to="/series"
            data-nav
            className="inline-flex w-fit items-center gap-1.5 text-xs text-mist-400 transition-colors hover:text-jade-300"
          >
            <Icon name="arrow-left" size={14} />
            All series
          </Link>

          <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold tracking-tight text-mist-50 md:text-3xl">
                {title}
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-mist-400">
                {series.year ? <span className="tabular-nums">{series.year}</span> : null}
                <RatingBadge rating={seriesRating} />
                {series.group ? <span>{series.group}</span> : null}
                {series.language ? <span>{series.language}</span> : null}
                <span className="tabular-nums">
                  {series.episodeCount} episode{series.episodeCount === 1 ? '' : 's'}
                </span>
                <span>{series.seasons.length} season{series.seasons.length === 1 ? '' : 's'}</span>
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {firstUnwatched ? (
                  <ButtonLink to={watchPath(firstUnwatched)} size="lg" icon="play">
                    {progressById.get(firstUnwatched.id)?.percent
                      ? 'Resume episode'
                      : 'Play episode'}
                  </ButtonLink>
                ) : null}
                <IconButton
                  icon={favorite ? 'check' : 'plus'}
                  label={favorite ? 'Remove from My List' : 'Add to My List'}
                  size="lg"
                  variant="secondary"
                  active={favorite}
                  onClick={() => {
                    // The series itself is not a playlist entry, so this
                    // favourites the next playable episode instead.
                    if (firstUnwatched && !isFavorite(firstUnwatched.id)) {
                      toggleFavorite(firstUnwatched);
                    }
                  }}
                />
              </div>
            </div>

            {series.logo ? (
              <div className="w-[110px] shrink-0 overflow-hidden rounded-lg shadow-lift sm:w-[132px]">
                <LazyImage src={series.logo} alt="" width={264} height={396} fit="cover" priority />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Season picker */}
      {series.seasons.length > 1 ? (
        <div
          role="tablist"
          aria-label="Seasons"
          className="row-scroll mb-4 flex gap-1.5 overflow-x-auto px-4 md:px-8"
        >
          {series.seasons.map((s) => {
            const active = s.season === season.season;
            return (
              <button
                key={s.season}
                role="tab"
                type="button"
                data-nav
                aria-selected={active}
                onClick={() => setActiveSeason(s.season)}
                className={`inline-flex h-8 shrink-0 items-center rounded-md px-3 text-xs font-semibold transition-colors ${
                  active ? 'bg-ink-700 text-mist-50' : 'text-mist-400 hover:bg-ink-800 hover:text-mist-200'
                }`}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Episode list */}
      <section className="px-4 pb-4 md:px-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-mist-200">{season.name}</h2>
          <p className="text-xs tabular-nums text-mist-500">
            {season.episodes.length} episode{season.episodes.length === 1 ? '' : 's'}
          </p>
        </div>

        <ul className="space-y-1.5">
          {season.episodes.map((episode) => {
            const progress = progressById.get(episode.id);
            const isResume = progress && progress.percent > 0.01 && progress.percent < 0.95;
            const label = cleanTitle(episode.name) || episode.name;
            return (
              <li key={episode.id}>
                <div
                  data-nav
                  className="group/ep flex items-center gap-3 rounded-lg border border-transparent bg-ink-900/60 p-2 transition-colors hover:border-ink-700 hover:bg-ink-850 focus-within:border-jade-600"
                >
                  <Link
                    to={watchPath(episode)}
                    className="flex min-w-0 flex-1 items-center gap-3"
                    aria-label={`Play episode ${episode.episode ?? ''}: ${label}${
                      isResume ? `, ${formatTime(progress.duration - progress.position)} remaining` : ''
                    }`}
                  >
                    <span className="relative w-[64px] shrink-0 overflow-hidden rounded bg-ink-800 sm:w-[84px]">
                      <LazyImage
                        src={episode.logo}
                        alt=""
                        width={168}
                        height={96}
                        fit="cover"
                        rounded="rounded"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover/ep:opacity-100">
                        <Icon name="play" size={18} className="text-white" filled />
                      </span>
                      {isResume ? (
                        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-black/60">
                          <span
                            className="block h-full bg-jade-400"
                            style={{ width: `${Math.round(progress.percent * 100)}%` }}
                          />
                        </span>
                      ) : null}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-mist-100">
                        {episode.episode != null ? `E${episode.episode} · ` : ''}
                        {label}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-mist-500">
                        {isResume
                          ? `${formatTime(progress.duration - progress.position)} left`
                          : episode.durationSec
                            ? formatDuration(episode.durationSec)
                            : 'Not started'}
                        {progress && progress.percent >= 0.95 ? ' · Watched' : ''}
                      </span>
                    </span>
                  </Link>

                  <div className="flex shrink-0 items-center gap-1">
                    {progress && progress.percent > 0.01 ? (
                      <IconButton
                        icon="close"
                        label="Clear resume position"
                        size="sm"
                        onClick={() => {
                          clearProgress(episode.id);
                          void saveProgress(episode, 0, 0, 0);
                        }}
                      />
                    ) : null}
                    <IconButton
                      icon={favoriteIds.has(episode.id) ? 'check' : 'plus'}
                      label={favoriteIds.has(episode.id) ? 'Remove from My List' : 'Add to My List'}
                      size="sm"
                      active={favoriteIds.has(episode.id)}
                      onClick={() => onToggleFavorite(episode)}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Up next shortcut: jump straight into the next episode of this season. */}
      {season.episodes.length > 1 ? (
        <div className="px-4 pb-4 md:px-8">
          <h2 className="mb-2 text-sm font-semibold tracking-tight text-mist-200">
            More from {season.name}
          </h2>
          <div className="row-scroll flex gap-2.5 overflow-x-auto pb-1">
            {season.episodes.slice(0, 20).map((episode) => (
              <ContentCard
                key={episode.id}
                item={episode}
                variant="wide"
                progress={progressById.get(episode.id)}
                favorite={favoriteIds.has(episode.id)}
                onToggleFavorite={onToggleFavorite}
                showEpisodeMeta
              />
            ))}
          </div>
        </div>
      ) : null}

      <PageEnd />
    </div>
  );
}
