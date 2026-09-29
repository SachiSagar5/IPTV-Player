/**
 * Content cards.
 *
 * One card component with a `variant` prop rather than four near-identical
 * components, because the hover/focus/select/lazy-load logic is identical and
 * duplicating it four times is how the four versions drift apart.
 *
 * Everything here is `React.memo`'d on primitives, because a Home page can
 * mount 400+ cards and any prop that is a fresh object/array would otherwise
 * re-render the whole grid on an unrelated store update.
 */
import { memo, useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ContentItem, PlaybackProgress } from '@/types';
import { LazyImage } from '@/components/common/LazyImage';
import { Icon } from '@/components/common/Icon';
import { cleanTitle } from '@/services/m3u/categorize';
import { usePoster } from '@/hooks/usePoster';
import { useItemRating } from '@/hooks/useRating';
import { RatingBadge } from '@/components/common/RatingBadge';
import { useAppSelector } from '@/store/appStore';
import { formatDuration, formatEpisodeLabel, formatTime } from '@/utils/format';
import { watchPath } from '@/utils/routes';

export type CardVariant = 'poster' | 'channel' | 'wide';

const SIZES: Record<CardVariant, { w: number; h: number; className: string }> = {
  poster: { w: 380, h: 570, className: 'w-[132px] sm:w-[164px] lg:w-[190px]' },
  channel: { w: 320, h: 320, className: 'w-[104px] sm:w-[124px] lg:w-[142px]' },
  wide: { w: 480, h: 270, className: 'w-[200px] sm:w-[248px] lg:w-[288px]' },
};

/**
 * Widths for cards inside a horizontal row, ~1.3x `SIZES`.
 *
 * A row and a grid want different sizes from the same card. In a grid the card
 * is one of many and is sized by its `1fr` column, so a card that is generously
 * wide just eats viewport. In a horizontal row the artwork *is* the browse
 * surface and the row scrolls, so there is no cost to showing it larger.
 *
 * Kept as a separate table rather than a multiplier so the breakpoints stay
 * tuned per variant: a square channel tile and a 2:3 poster cannot both be
 * scaled by the same factor and still fit the same number of cards per screen.
 *
 * Intrinsic `w`/`h` are deliberately untouched — they only carry the aspect
 * ratio, and the browser scales the artwork down to fit the rendered width.
 */
export const LARGE_CARD_WIDTH: Record<CardVariant, string> = {
  poster: 'w-[164px] sm:w-[210px] lg:w-[246px]',
  channel: 'w-[132px] sm:w-[168px] lg:w-[196px]',
  wide: 'w-[268px] sm:w-[332px] lg:w-[384px]',
};

export interface ContentCardProps {
  item: ContentItem;
  variant?: CardVariant;
  progress?: PlaybackProgress;
  favorite?: boolean;
  /** Season/episode line under the title, for episode entries. */
  showEpisodeMeta?: boolean;
  /** 1-based index used for the "10" accessibility label on grids. */
  index?: number;
  total?: number;
  onToggleFavorite?: (item: ContentItem) => void;
  priority?: boolean;
  /**
   * Use the larger row widths (`LARGE_CARD_WIDTH`) instead of `SIZES`.
   *
   * For horizontal rows, where the artwork is the point. Ignored when `fill` is
   * set, since a grid cell is fluid and has no business asking for a width.
   */
  large?: boolean;
  /**
   * Stretch to the grid cell instead of using the fixed row width.
   *
   * Horizontal rows need an intrinsic width (the row scrolls, so cards must size
   * themselves). Grid cells do not: a `1fr` column is fluid, and pinning the card
   * to a fixed width inside it is what made grid cards overlap each other and
   * leave a ragged right edge.
   */
  fill?: boolean;
  className?: string;
}

export const ContentCard = memo(function ContentCard({
  item,
  variant = 'poster',
  progress,
  favorite = false,
  showEpisodeMeta = false,
  index,
  total,
  onToggleFavorite,
  priority = false,
  fill = false,
  large = false,
  className = '',
}: ContentCardProps) {
  const size = SIZES[variant];
  const displayTitle = cleanTitle(item.name) || item.name;
  const isLive = item.kind === 'live';

  // Falls back to a fetched poster when the provider gave us no logo. The hook is
  // a no-op for live channels and whenever the setting is off.
  const autoFetchPosters = useAppSelector((s) => s.settings.autoFetchPosters);
  const artwork = usePoster({
    kind: item.kind,
    title: item.name,
    year: item.year,
    logo: item.logo,
    enabled: autoFetchPosters && variant === 'poster',
  });
  // A rating needs the title matched to a work first, so it follows the same
  // third-party opt-in as artwork. A live channel has no rating to show, and
  // wide cards are text-only rows where a chip would be noise.
  const rating = useItemRating({
    kind: item.kind,
    title: item.name,
    enabled: autoFetchPosters && variant === 'poster' && !isLive,
  });
  const href = watchPath(item);

  const handleFavorite = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onToggleFavorite?.(item);
    },
    [item, onToggleFavorite],
  );

  const progressPercent = progress && progress.duration > 0
    ? Math.min(100, Math.round(progress.percent * 100))
    : 0;

  const episodeMeta =
    showEpisodeMeta || item.kind === 'series' ? formatEpisodeLabel(item.season, item.episode) : '';
  const yearLabel = item.year ? String(item.year) : '';
  const runtimeLabel = item.durationSec ? formatDuration(item.durationSec) : '';

  const label = [displayTitle, episodeMeta, yearLabel, runtimeLabel, isLive ? 'Live TV' : '']
    .filter(Boolean)
    .join(', ');

  return (
    <Link
      to={href}
      data-nav
      aria-label={label}
      {...(index != null && total != null ? { 'aria-posinset': index + 1, 'aria-setsize': total } : {})}
      className={`card group/card relative block shrink-0 rounded-card outline-offset-4 ${
        fill ? 'w-full' : large ? LARGE_CARD_WIDTH[variant] : size.className
      } ${className}`}
    >
      <div className="card-art card-hairline relative overflow-hidden rounded-card bg-ink-850 shadow-card transition-[transform,box-shadow] duration-300 ease-settle group-hover/card:-translate-y-2 group-hover/card:shadow-lift group-focus-visible/card:-translate-y-2 group-focus-visible/card:shadow-lift">
        <LazyImage
          src={artwork}
          alt={displayTitle}
          width={size.w}
          height={size.h}
          priority={priority}
          fit={variant === 'channel' ? 'contain' : 'cover'}
          rounded="rounded-card"
          fallbackText={displayTitle}
          className={variant === 'channel' ? 'p-[8%]' : ''}
        />

        {/* Top-to-bottom scrim. Always present at a low opacity rather than
            fading in on hover: it is what makes the chips legible over a pale
            poster, and a chip that changes contrast on hover is unreadable
            exactly when the pointer is closest to it. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/60 to-transparent opacity-80 transition-opacity duration-300 group-hover/card:opacity-100"
        />

        {/* Live badge. Present only for live channels. */}
        {isLive ? (
          <span className="pointer-events-none absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full border border-live-500/30 bg-black/70 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-live-400 uppercase backdrop-blur-sm">
            <span className="live-pulse h-1.5 w-1.5 rounded-full bg-live-400 shadow-[0_0_8px_2px_rgba(255,90,90,0.7)]" />
            Live
          </span>
        ) : null}

        {/* Metadata chips, only when the provider gave us something useful. */}
        {!isLive && (item.year || item.durationSec || rating !== undefined) ? (
          <div className="pointer-events-none absolute right-1.5 bottom-1.5 flex items-center gap-1">
            {yearLabel ? (
              <span className="rounded-md border border-white/10 bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold text-mist-200 backdrop-blur-sm transition-colors duration-200 group-hover/card:bg-black/85">
                {yearLabel}
              </span>
            ) : null}
            {runtimeLabel ? (
              <span className="rounded-md border border-white/10 bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold text-mist-200 backdrop-blur-sm transition-colors duration-200 group-hover/card:bg-black/85">
                {runtimeLabel}
              </span>
            ) : null}
            {/* Matching the chip background keeps the score legible over any
                artwork instead of relying on the poster's own colours. */}
            {rating !== undefined ? (
              <span className="rounded-md border border-white/10 bg-black/65 px-1.5 py-0.5 backdrop-blur-sm transition-colors duration-200 group-hover/card:bg-black/85">
                <RatingBadge rating={rating} compact />
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Resume bar. */}
        {progressPercent > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/60">
            <div
              className="h-full bg-gradient-to-r from-accent-500 to-accent-300 shadow-[0_0_8px_rgb(var(--accent-400-rgb)/0.6)]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        ) : null}

        {/* Play affordance revealed on hover/focus only — no idle animation.
            The full-bleed scrim fades without scaling (scaling it would pull its
            own edges off the artwork and expose a ring of bare card); only the
            button itself pops. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/75 via-black/10 to-transparent opacity-0 transition-opacity duration-200 group-hover/card:opacity-100 group-focus-visible/card:opacity-100">
          <span className="flex h-11 w-11 scale-75 items-center justify-center rounded-full border border-white/20 bg-white/95 text-ink-1000 opacity-0 shadow-lift transition-[transform,opacity] duration-300 ease-present group-hover/card:scale-100 group-hover/card:opacity-100 group-focus-visible/card:scale-100 group-focus-visible/card:opacity-100">
            <Icon name="play" size={19} filled />
          </span>
        </div>

        {/* Quick add to My List. Always reachable by keyboard. */}
        {onToggleFavorite ? (
          <button
            type="button"
            data-nav={false}
            onClick={handleFavorite}
            aria-pressed={favorite}
            aria-label={favorite ? `Remove ${displayTitle} from My List` : `Add ${displayTitle} to My List`}
            title={favorite ? 'Remove from My List' : 'Add to My List'}
            className={`absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-md border backdrop-blur-sm transition-all duration-200 focus-visible:opacity-100 ${
              favorite
                ? 'border-accent-400/60 bg-accent-500/90 text-ink-1000 opacity-100 shadow-[0_0_12px_rgb(var(--accent-400-rgb)/0.4)]'
                : 'border-white/15 bg-black/60 text-mist-200 opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100'
            }`}
          >
            <Icon name={favorite ? 'check' : 'plus'} size={14} />
          </button>
        ) : null}

        {/* Accent ring, drawn last so it sits over the scrim. */}
        <span className="card-glow pointer-events-none absolute inset-0 rounded-card" />
      </div>

      <div className="mt-2.5 px-0.5">
        <p
          className={`truncate text-[13px] leading-tight font-medium text-mist-300 transition-colors group-hover/card:text-mist-50 ${
            variant === 'channel' ? 'text-center' : ''
          }`}
          title={displayTitle}
        >
          {displayTitle}
        </p>
        {episodeMeta || item.group ? (
          <p className="mt-1 truncate text-[11px] leading-tight text-mist-500 transition-colors duration-200 group-hover/card:text-mist-400">
            {episodeMeta || item.group}
          </p>
        ) : null}
        {progress && progress.duration > 0 ? (
          <p className="mt-1 truncate text-[11px] leading-tight font-medium text-accent-400">
            {formatTime(progress.position)} left
          </p>
        ) : null}
      </div>
    </Link>
  );
});
