/**
 * Series card.
 *
 * Series are a *derived* grouping, not a playlist entry, so this card links to
 * `/series/:id` rather than the player. The tile is 2:3 like a poster so the
 * Series page grid lines up with the Movies grid.
 */
import { memo } from 'react';
import { Link } from 'react-router-dom';
import type { SeriesGroup } from '@/types';
import { LazyImage } from '@/components/common/LazyImage';
import { Icon } from '@/components/common/Icon';
import { cleanTitle } from '@/services/m3u/categorize';
import { usePoster } from '@/hooks/usePoster';
import { useItemRating } from '@/hooks/useRating';
import { RatingBadge } from '@/components/common/RatingBadge';
import { useAppSelector } from '@/store/appStore';
import { seriesPath } from '@/utils/routes';

export interface SeriesCardProps {
  series: SeriesGroup;
  index?: number;
  total?: number;
}

export const SeriesCard = memo(function SeriesCard({ series, index, total }: SeriesCardProps) {
  const title = cleanTitle(series.name) || series.name;
  const resume = series.progress;

  // Series groups inherit a logo from whichever episode had one. When none did,
  // fall back to a fetched poster for the series title.
  const autoFetchPosters = useAppSelector((s) => s.settings.autoFetchPosters);
  const artwork = usePoster({
    kind: 'series',
    title: series.name,
    year: series.year,
    logo: series.logo,
    enabled: autoFetchPosters,
  });
  const remaining = resume && resume.duration > 0 ? 1 - resume.percent : 0;
  // Same third-party opt-in as the poster above it: a rating needs the title
  // matched to a work first.
  const rating = useItemRating({
    kind: 'series',
    title: series.name,
    enabled: autoFetchPosters,
  });

  return (
    <Link
      to={seriesPath(series.id)}
      data-nav
      tabIndex={0}
      aria-label={`${title}, ${series.episodeCount} episodes`}
      className="card group/card block min-w-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400"
    >
      <div className="card-art relative overflow-hidden rounded-card bg-ink-850 shadow-card transition-[transform,box-shadow] duration-300 ease-settle group-hover/card:-translate-y-1.5 group-hover/card:shadow-lift group-focus-visible/card:-translate-y-1.5 group-focus-visible/card:shadow-lift">
        <LazyImage
          src={artwork}
          alt=""
          width={380}
          height={570}
          fit="cover"
          rounded="rounded-card"
        />

        {series.episodeCount > 0 || rating !== undefined ? (
          <div className="absolute right-1.5 bottom-1.5 flex items-center gap-1">
            {rating !== undefined ? (
              <span className="rounded-md bg-black/75 px-1.5 py-0.5 backdrop-blur-sm transition-colors duration-200 group-hover/card:bg-black/85">
                <RatingBadge rating={rating} compact />
              </span>
            ) : null}
            {series.episodeCount > 0 ? (
              <span className="rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white/90 backdrop-blur-sm transition-colors duration-200 group-hover/card:bg-black/85">
                {series.episodeCount} ep
              </span>
            ) : null}
          </div>
        ) : null}

        {resume ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
            <div
              className="h-full bg-accent-400"
              style={{ width: `${Math.round(remaining * 100)}%` }}
            />
          </div>
        ) : null}

        <span className="card-glow pointer-events-none absolute inset-0 rounded-card" />
      </div>

      <h3 className="mt-2.5 truncate text-[13px] font-medium text-mist-200 transition-colors group-hover/card:text-mist-50">
        {title}
      </h3>
      <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-mist-500 transition-colors duration-200 group-hover/card:text-mist-400">
        {series.year ? <span className="tabular-nums">{series.year}</span> : null}
        {series.year && series.group ? <span aria-hidden="true">·</span> : null}
        {series.group ? <span className="truncate">{series.group}</span> : null}
        {!series.year && !series.group ? (
          <>
            <Icon name="tv" size={11} />
            <span className="tabular-nums">
              {index != null && total != null ? `${index + 1} of ${total}` : ''}
            </span>
          </>
        ) : null}
      </p>
    </Link>
  );
});
