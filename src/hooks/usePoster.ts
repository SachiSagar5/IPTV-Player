/**
 * `usePoster` — the bridge between a rendered card and the poster store.
 *
 * Cards are the only trigger for a lookup. Because the browse grids are
 * virtualised, a card mounts only when it is scrolled near the viewport, so the
 * request rate is bounded by human scroll speed rather than by playlist size.
 * `LazyImage` adds its own IntersectionObserver, so a poster is also only ever
 * *downloaded* when it is actually about to be seen.
 *
 * Returns the URL to display: the provider's own `logo` whenever it has one, and
 * the fetched poster only as a fallback. A playlist's artwork is always
 * preferred — it is the artwork that playlist was assembled with.
 */
import { useEffect, useMemo } from 'react';
import { keyForTitle, posterStore, requestPoster, type PosterResult } from '@/store/posterStore';
import { useStoreSelector } from '@/store/store';
import type { ContentKind } from '@/types';

interface UsePosterOptions {
  kind: ContentKind;
  title: string;
  year?: number;
  /** The provider's own artwork, used when present. */
  logo?: string;
  enabled: boolean;
}

type PosterMap = Record<string, PosterResult | null>;

export function usePoster({
  kind,
  title,
  year,
  logo,
  enabled,
}: UsePosterOptions): string | undefined {
  // Providers very often emit an *empty* `tvg-logo` rather than omitting the
  // attribute, so an empty/whitespace string has to be treated as "no artwork".
  // Using `logo ?? fallback` here would return that empty string and silently
  // suppress the fetched poster: the lookup runs, the store fills, and nothing
  // is ever displayed.
  const providerLogo = logo && logo.trim() ? logo : undefined;

  // Only movies and series get fetched posters. A live channel's "title" is a
  // channel name; looking those up would yield noise and pointless traffic.
  const lookupKind = kind === 'series' ? 'series' : kind === 'movie' ? 'movie' : null;
  const lookupable = enabled && lookupKind !== null && providerLogo === undefined;

  // Enqueue on mount, or when the title changes. Never on scroll.
  useEffect(() => {
    if (!lookupable || !lookupKind) return;
    requestPoster(lookupKind, title, year);
  }, [lookupable, lookupKind, title, year]);

  // The key must be derived during render so the selector can read it on the
  // same commit; `requestPoster` is idempotent and does no I/O.
  const key = lookupable && lookupKind ? keyForTitle(lookupKind, title) : null;

  // Read exactly this one key. A store update for a different title re-renders
  // nothing, which matters with thousands of mounted cards.
  const selector = useMemo(
    () =>
      (state: PosterMap): PosterResult | null | undefined =>
        key === null ? undefined : state[key],
    [key],
  );

  const resolved = useStoreSelector(posterStore, selector);
  return providerLogo ?? resolved?.poster ?? undefined;
}
