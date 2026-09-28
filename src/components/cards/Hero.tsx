/**
 * Cinematic hero.
 *
 * The backdrop is the item's own artwork, layered in three passes so it reads as
 * a poster rather than a wallpaper:
 *   1. a heavily blurred wash that fills the whole container and guarantees the
 *      hero is never a flat gradient, whatever the source aspect ratio is;
 *   2. the poster itself, anchored to the right edge and masked into the wash,
 *      so the artwork is legible without fighting the headline;
 *   3. scrims that keep the text column readable and fade the whole thing into
 *      the page background at the bottom.
 *
 * Artwork is resolved through `usePoster`, so a movie with no `tvg-logo` still
 * gets a real backdrop. The poster is the LCP candidate, so it is preloaded; the
 * blurred wash is painted from the same URL and therefore costs no extra
 * request.
 */
import { memo } from 'react';
import { Link } from 'react-router-dom';
import type { ContentItem, PlaybackProgress } from '@/types';
import { ButtonLink, IconButton } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { LazyImage } from '@/components/common/LazyImage';
import { cleanTitle } from '@/services/m3u/categorize';
import { usePoster } from '@/hooks/usePoster';
import { useAppSelector } from '@/store/appStore';
import { formatDuration, formatTime } from '@/utils/format';
import { watchPath } from '@/utils/routes';

/**
 * The poster CDN serves a small asset by default. The hero is the one place the
 * same poster is shown large, so upgrade to the big variant when the URL is one
 * we know has size segments. Anything else is used as-is.
 */
function upscaleArtwork(url: string): string {
  return url.replace('/poster/medium/', '/poster/large/');
}

export interface HeroProps {
  item: ContentItem;
  progress?: PlaybackProgress;
  favorite?: boolean;
  onToggleFavorite?: (item: ContentItem) => void;
  resume?: boolean;
}

export const Hero = memo(function Hero({
  item,
  progress,
  favorite = false,
  onToggleFavorite,
  resume = false,
}: HeroProps) {
  const title = cleanTitle(item.name) || item.name;
  const isLive = item.kind === 'live';

  // No-op for live channels, and for playlists that already carry a logo.
  const autoFetchPosters = useAppSelector((s) => s.settings.autoFetchPosters);
  const artwork = usePoster({
    kind: item.kind,
    title: item.name,
    year: item.year,
    logo: item.logo,
    enabled: autoFetchPosters,
  });
  const art = artwork ? upscaleArtwork(artwork) : '';
  const artCss = art ? `url("${encodeURI(art)}")` : undefined;

  const meta: string[] = [];
  if (item.year) meta.push(String(item.year));
  if (item.durationSec) meta.push(formatDuration(item.durationSec));
  if (item.group) meta.push(item.group);
  if (isLive) meta.unshift('Live');

  const remaining =
    progress && progress.duration > 0
      ? formatTime(Math.max(0, progress.duration - progress.position))
      : '';

  return (
    <section className="relative isolate overflow-hidden" aria-label={`Featured: ${title}`}>
      {/* 1. Ambient wash — fills the container regardless of the poster's shape. */}
      {artCss ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-30 scale-110 opacity-40 blur-3xl saturate-150"
          style={{ backgroundImage: artCss, backgroundSize: 'cover', backgroundPosition: 'center 22%' }}
        />
      ) : null}

      {/* 2. The poster itself, bleeding off the right edge and masked into the wash.
          A single slow push-in over 22s gives the hero a sense of life without
          competing with the headline; it plays once on mount, not on a loop. */}
      {artCss ? (
        <div
          aria-hidden="true"
          className="animate-ken-burns absolute inset-y-0 right-0 -z-20 w-full bg-no-repeat opacity-95 md:w-[68%]"
          style={{
            backgroundImage: artCss,
            backgroundSize: 'cover',
            backgroundPosition: 'right top',
            maskImage: 'linear-gradient(to right, transparent, rgba(0,0,0,0.5) 34%, #000 70%)',
            WebkitMaskImage: 'linear-gradient(to right, transparent, rgba(0,0,0,0.5) 34%, #000 70%)',
          }}
        />
      ) : null}

      {/* 3. Scrims: left for the headline, bottom to melt into the first row. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-r from-ink-950 from-5% via-ink-950/90 to-ink-950/25"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 -z-10 h-32 bg-gradient-to-b from-ink-950/90 to-transparent"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-t from-ink-950 via-ink-950/45 to-transparent"
      />

      <div className="flex flex-col gap-7 px-4 pt-28 pb-12 sm:pt-32 md:flex-row md:items-end md:gap-10 md:px-8 md:pt-40 md:pb-16">
        <div className="min-w-0 flex-1">
          {isLive ? (
            <span className="animate-rise mb-3 inline-flex items-center gap-1.5 rounded-full border border-live-500/40 bg-live-500/12 px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] text-live-400 uppercase">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live-400" />
              Live now
            </span>
          ) : null}

          <h1
            className="animate-rise text-balance text-3xl leading-[1.05] font-bold tracking-tight text-mist-50 drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)] sm:text-4xl lg:text-5xl"
            style={{ animationDelay: '40ms' }}
          >
            {title}
          </h1>

          {meta.length > 0 ? (
            <div
              className="animate-rise mt-3.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-mist-300 sm:text-sm"
              style={{ animationDelay: '100ms' }}
            >
              {meta.map((entry, i) => (
                <span key={entry} className="inline-flex items-center gap-2.5">
                  {i > 0 ? <span className="h-1 w-1 rounded-full bg-mist-500" /> : null}
                  {entry}
                </span>
              ))}
            </div>
          ) : null}

          {progress && progress.duration > 0 ? (
            <div className="animate-rise mt-6 max-w-md" style={{ animationDelay: '160ms' }}>
              <div className="h-1 overflow-hidden rounded-full bg-ink-700/80">
                <div
                  className="h-full rounded-full bg-jade-400"
                  style={{ width: `${Math.round(progress.percent * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-mist-400">{remaining} remaining</p>
            </div>
          ) : null}

          <div
            className="animate-rise mt-7 flex flex-wrap items-center gap-2.5"
            style={{ animationDelay: '220ms' }}
          >
            <ButtonLink to={watchPath(item)} size="lg" icon="play">
              {resume ? 'Resume' : 'Play'}
            </ButtonLink>

            {onToggleFavorite ? (
              <IconButton
                icon={favorite ? 'check' : 'plus'}
                label={favorite ? 'Remove from My List' : 'Add to My List'}
                size="lg"
                variant="secondary"
                active={favorite}
                onClick={() => onToggleFavorite(item)}
              />
            ) : null}
          </div>

          <p
            className="animate-rise mt-5 flex max-w-lg items-start gap-1.5 text-xs text-mist-500"
            style={{ animationDelay: '280ms' }}
          >
            <Icon name="info" size={13} className="mt-0.5 shrink-0" />
            <span>
              M3U playlists rarely include synopses, so this player shows the metadata that is
              actually present and never invents a description.
            </span>
          </p>
        </div>

        {/* Channel logos are square, so a live hero gets a crisp tile rather than
            a poster bleed. */}
        {isLive && artwork ? (
          <Link
            to={watchPath(item)}
            data-nav
            tabIndex={-1}
            aria-hidden="true"
            className="animate-rise hidden w-[132px] shrink-0 overflow-hidden rounded-lg shadow-lift md:block lg:w-[164px]"
            style={{ animationDelay: '200ms' }}
          >
            <LazyImage
              src={art}
              alt=""
              width={320}
              height={320}
              priority
              fit="contain"
              rounded="rounded-lg"
              className="bg-ink-850 p-[10%]"
            />
          </Link>
        ) : null}
      </div>
    </section>
  );
});
