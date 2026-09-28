import { useMemo } from 'react';
import { CatalogPage } from '@/components/layout/CatalogPage';
import { Button } from '@/components/common/Button';
import {
  countHiddenChannels,
  getHiddenChannelIds,
  restoreHiddenChannels,
  useAppSelector,
} from '@/store/appStore';
import { formatCount } from '@/utils/format';

export default function LiveTvPage() {
  const liveFailures = useAppSelector((s) => s.liveFailures);
  const activePlaylistId = useAppSelector((s) => s.activePlaylistId);
  const playlists = useAppSelector((s) => s.playlists);

  // Both derived from the same record map, and the selector caches on its
  // identity, so a re-render with no new failures costs a map lookup.
  const hiddenIds = useMemo(() => getHiddenChannelIds(), [liveFailures]);
  const hiddenCount = useMemo(
    () => countHiddenChannels(activePlaylistId),
    [liveFailures, activePlaylistId],
  );

  // The playlist's own live total, *before* anything is withheld. Without this
  // the page cannot tell "this playlist has no live channels" apart from "every
  // channel here is hidden", and the second one would be reported as the first.
  const liveTotal = useMemo(() => {
    const meta = playlists.find((p) => p.id === activePlaylistId);
    return meta?.counts.live ?? 0;
  }, [playlists, activePlaylistId]);
  const everythingHidden = hiddenCount > 0 && hiddenCount >= liveTotal;

  return (
    <CatalogPage
      kind="live"
      title="Live TV"
      // Poster cards, same size as Movies. The old `channel` variant was a
      // 142px square, which left the Live TV grid visibly denser and its cards
      // much smaller than every other browse page. Logos now cover-fill a 2:3
      // frame instead of sitting letterboxed in a square; the LIVE badge is
      // driven by `kind`, not by the variant, so it is unaffected.
      variant="poster"
      showSort={false}
      showFavorites={false}
      excludeIds={hiddenIds}
      notice={
        hiddenCount > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/8 bg-ink-900/70 px-3.5 py-2.5 text-xs text-mist-400">
            <span className="min-w-0 flex-1">
              {hiddenCount === 1
                ? '1 channel is hidden because it failed to play.'
                : `${formatCount(hiddenCount)} channels are hidden because they failed to play.`}
            </span>
            <Button variant="ghost" size="sm" onClick={() => restoreHiddenChannels(activePlaylistId)}>
              Show them anyway
            </Button>
          </div>
        ) : null
      }
      emptyTitle={everythingHidden ? 'Every channel here failed to play' : 'No live channels'}
      emptyMessage={
        everythingHidden
          ? `All ${formatCount(liveTotal)} live channels in this playlist stopped working, so they are hidden. Show them anyway to try one, or refresh the playlist if the provider has fixed them.`
          : 'This playlist has no entries classified as live channels. If it should, add `group-title` hints or check the Movies tab.'
      }
    />
  );
}
