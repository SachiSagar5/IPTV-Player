/**
 * `useRating` — the bridge between a rendered surface and the rating store.
 *
 * Unlike posters, a rating is only ever requested for a *single* title the user
 * is looking at (or watching), so there is no per-card fan-out here: the queue
 * sees roughly one id per title opened.
 *
 * The IMDb id is the input, not the title. A rating can only be fetched once the
 * title has been matched to a work, and that match is what `posterStore` already
 * does — so this deliberately reuses its result rather than running a second,
 * looser title search that could attach the rating to a different film.
 */
import { useEffect, useMemo } from 'react';
import { metaStore, requestRating, type MetaMap } from '@/store/metaStore';
import { keyForTitle, posterStore, requestPoster, type PosterMap } from '@/store/posterStore';
import { useStoreSelector } from '@/store/store';
import type { PosterKind } from '@/services/metadata/cinemeta';
import type { ContentKind } from '@/types';

interface UseRatingOptions {
  /** IMDb id from an existing title match, e.g. `tt1375666`. */
  imdbId?: string;
  kind?: PosterKind;
  /** Lets a surface opt out (e.g. live TV, which has no rating). */
  enabled: boolean;
}

/**
 * The IMDb score, or `undefined` while unknown or known-missing.
 *
 * `undefined` deliberately covers both "not fetched yet" and "fetched, genuinely
 * unrated", so a caller cannot accidentally treat a pending lookup as a zero.
 */
export function useRating({ imdbId, kind = 'movie', enabled }: UseRatingOptions): number | undefined {
  const usable = enabled && Boolean(imdbId);

  useEffect(() => {
    if (!usable || !imdbId) return;
    requestRating(imdbId, kind);
  }, [usable, imdbId, kind]);

  // Read exactly this one id, so an unrelated title's rating resolving re-renders
  // nothing.
  const selector = useMemo(
    () =>
      (state: MetaMap) =>
        !usable || !imdbId ? undefined : (state[imdbId]?.rating ?? undefined),
    [usable, imdbId],
  );

  return useStoreSelector(metaStore, selector);
}

/**
 * The common case: the caller has a *title*, not an IMDb id.
 *
 * Chains the existing title→work match in `posterStore` and then the rating
 * lookup, so a surface can ask for "the rating of whatever this is" without
 * duplicating the matching rules — and, importantly, without a second, looser
 * title search that could return a different film's score. The rating therefore
 * appears only once the title has been confidently matched, which is why it
 * arrives a moment after the poster rather than with it.
 */
export function useItemRating({
  kind,
  title,
  enabled = true,
}: {
  kind: ContentKind;
  title: string;
  enabled?: boolean;
}): number | undefined {
  const lookupKind = kind === 'series' ? 'series' : kind === 'movie' ? 'movie' : null;
  const usable = enabled && lookupKind !== null;

  const key = usable && lookupKind ? keyForTitle(lookupKind, title) : null;

  // Ensure the title→work match exists. Cards trigger this via `usePoster`, but
  // the watch page mounts no cards, so without this the id would only ever be
  // present if the user happened to see that title in a grid first — and the
  // rating would silently never appear on a fresh launch.
  //
  // Unconditional, unlike `usePoster`: artwork is skipped when the playlist
  // supplies a `tvg-logo`, but here we need the *id*, not the image. It is still
  // one polite queued lookup per title, and `requestPoster` no-ops on a hit.
  useEffect(() => {
    if (!usable || !lookupKind) return;
    requestPoster(lookupKind, title);
  }, [usable, lookupKind, title]);

  const posterSelector = useMemo(
    () =>
      (state: PosterMap): string | undefined =>
        key === null ? undefined : state[key]?.imdbId || undefined,
    [key],
  );
  const imdbId = useStoreSelector(posterStore, posterSelector);

  return useRating({ imdbId, kind: lookupKind ?? 'movie', enabled: usable && Boolean(imdbId) });
}
