/**
 * Player route.
 *
 * Two shapes:
 *  - `/watch/:contentId`          plays a single entry
 *  - `/watch/series/:seriesId`    plays the resume point of a whole show
 *
 * The route resolves the target from the store's lookup maps (O(1), no scanning)
 * and passes a resolved resume position down, so the player component itself never
 * has to know about progress rules.
 *
 * Two maps are consulted, because this route serves the ordinary pages and the
 * locked Parent section alike. An entry in the reserved Parent playlist is refused
 * until the PIN has been entered, so a hand-typed `/watch/...` link is no way
 * around the gate.
 */
import { useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { VideoPlayer } from '@/components/player/VideoPlayer';
import { ContentCard } from '@/components/cards/ContentCard';
import { EmptyState } from '@/components/common/States';
import { ButtonLink } from '@/components/common/Button';
import { useAppSelector, clearProgress, saveProgress } from '@/store/appStore';
import { useAdultUnlocked } from '@/store/adultGate';
import { formatTime } from '@/utils/format';
import { parseWatchParam, seriesPath, watchPath, ROUTES } from '@/utils/routes';
import type { ContentItem } from '@/types';

export default function PlayerPage() {
  const { contentId, seriesId } = useParams();
  const navigate = useNavigate();
  const itemById = useAppSelector((s) => s.itemById);
  const seriesIndex = useAppSelector((s) => s.seriesIndex);
  // The watch route is shared with the Parent section, whose entries live in a
  // separate map so the ordinary pages can tell the two playlists apart.
  const parentItemById = useAppSelector((s) => s.parentItemById);
  const parentSeriesIndex = useAppSelector((s) => s.parentSeriesIndex);
  const unlocked = useAdultUnlocked();
  const progressById = useAppSelector((s) => s.progressById);
  const favoriteIds = useAppSelector((s) => s.favoriteIds);

  const isSeriesRoute = seriesId !== undefined;

  /**
   * Resolve the entry to play, plus the show it belongs to.
   *
   * `gated` reports that the entry was found but sits in the locked Parent
   * playlist, which is a different failure from "not found" and needs a different
   * message: a deep link to `/watch/...` must not become a way around the PIN.
   */
  const resolved = useMemo((): {
    item: ContentItem | null;
    episodes: ContentItem[];
    seriesId?: string;
    gated: boolean;
  } => {
    if (isSeriesRoute) {
      const wanted = parseWatchParam(seriesId) ?? '';
      const series = seriesIndex.byId.get(wanted) ?? parentSeriesIndex.byId.get(wanted);
      if (!series) return { item: null, episodes: [], gated: false };
      // A show in the reserved playlist is held back on the same terms as a
      // single entry, so the series route cannot be used to walk past the PIN.
      if (!seriesIndex.byId.has(wanted) && !unlocked) return { item: null, episodes: [], gated: true };
      // Prefer the most recently advanced episode of the whole show.
      const flat = series.seasons.flatMap((s) => s.episodes);
      const target =
        flat.find((e) => {
          const p = progressById.get(e.id);
          return p && p.percent > 0.01 && p.percent < 0.97;
        }) ?? flat[0];
      return { item: target ?? null, episodes: flat, seriesId: series.id, gated: false };
    }

    const id = parseWatchParam(contentId);
    const found = id ? (itemById.get(id) ?? parentItemById.get(id)) : undefined;
    if (!found) return { item: null, episodes: [], gated: false };

    // Found, but in the playlist reserved for the Parent section: hold it until
    // the PIN has been entered this session.
    if (!itemById.has(found.id) && !unlocked) return { item: null, episodes: [], gated: true };

    const owner = found.seriesId
      ? (seriesIndex.byId.get(found.seriesId) ?? parentSeriesIndex.byId.get(found.seriesId))
      : undefined;
    return {
      item: found,
      episodes: owner ? owner.seasons.flatMap((s) => s.episodes) : [],
      seriesId: owner?.id,
      gated: false,
    };
  }, [
    isSeriesRoute,
    contentId,
    seriesId,
    seriesIndex,
    parentSeriesIndex,
    itemById,
    parentItemById,
    unlocked,
    progressById,
  ]);

  const item = resolved.item;
  const startPosition = useMemo(() => {
    if (!item || item.kind === 'live') return 0;
    const progress = progressById.get(item.id);
    if (!progress || progress.percent <= 0.01 || progress.percent >= 0.97) return 0;
    return progress.position;
  }, [item, progressById]);

  const onBack = useCallback(() => {
    if (window.history.length > 1) navigate(-1);
    else navigate(resolved.seriesId ? seriesPath(resolved.seriesId) : '/');
  }, [navigate, resolved.seriesId]);

  /**
   * After an episode ends, advance to the next one. `episodes` is already in
   * season-then-episode order, so crossing a season boundary needs no special
   * case — the next entry in the list *is* the first episode of the next season.
   */
  const onEnded = useCallback(
    (finished: ContentItem) => {
      if (resolved.episodes.length === 0) return;
      const index = resolved.episodes.findIndex((e) => e.id === finished.id);
      const next = index >= 0 ? resolved.episodes[index + 1] : undefined;
      if (next) navigate(watchPath(next));
    },
    [navigate, resolved.episodes],
  );

  if (!item) {
    return (
      <EmptyState
        icon={resolved.gated ? 'lock' : 'alert'}
        title={resolved.gated ? 'This entry is locked' : 'Nothing to play'}
        message={
          resolved.gated
            ? 'It belongs to the playlist reserved for the Parent section. Enter the parental PIN there to watch it.'
            : 'This entry is not in the currently loaded playlist. It may belong to a playlist you have not selected, or it may have been removed by a refresh.'
        }
        action={
          resolved.gated ? (
            <ButtonLink to={ROUTES.adult} variant="primary" icon="lock-open">
              Go to Parent
            </ButtonLink>
          ) : (
            <ButtonLink to="/" variant="secondary" icon="arrow-left">
              Back to home
            </ButtonLink>
          )
        }
      />
    );
  }

  const resume =
    item.kind !== 'live' && startPosition > 0
      ? `${formatTime(Math.max(0, (progressById.get(item.id)?.duration ?? 0) - startPosition))} left`
      : '';

  return (
    <VideoPlayer
      item={item}
      startPosition={startPosition}
      onBack={onBack}
      onEnded={onEnded}
    >
      {/* Below-the-video chrome. Kept minimal so the video stays the hero. */}
      <section className="px-4 py-5 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-mist-50">{item.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-mist-500">
              {item.group ? <span>{item.group}</span> : null}
              {item.language ? <span>{item.language}</span> : null}
              {resume ? <span className="text-accent-400">{resume}</span> : null}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {startPosition > 0 ? (
              <button
                type="button"
                onClick={() => {
                  clearProgress(item.id);
                  void saveProgress(item, 0, 0, 0);
                }}
                className="text-xs text-mist-500 underline-offset-2 transition-colors hover:text-mist-200 hover:underline"
              >
                Start over
              </button>
            ) : null}
            {resolved.seriesId ? (
              <ButtonLink to={seriesPath(resolved.seriesId)} variant="secondary" size="sm">
                All episodes
              </ButtonLink>
            ) : null}
          </div>
        </div>

        {resolved.episodes.length > 1 ? (
          <div className="mt-5">
            <h2 className="mb-2 text-xs font-semibold tracking-[0.12em] text-mist-500 uppercase">
              Up next
            </h2>
            <div className="row-scroll flex gap-2.5 overflow-x-auto pb-1">
              {resolved.episodes.slice(0, 24).map((episode) => (
                <ContentCard
                  key={episode.id}
                  item={episode}
                  variant="wide"
                  progress={progressById.get(episode.id)}
                  favorite={favoriteIds.has(episode.id)}
                  showEpisodeMeta
                />
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </VideoPlayer>
  );
}
