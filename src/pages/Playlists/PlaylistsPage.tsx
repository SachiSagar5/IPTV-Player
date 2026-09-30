/**
 * Playlist management.
 *
 * Add, switch, rename, refresh, delete. Every action goes through the store, so
 * the same code paths are exercised by the onboarding flow and by a future
 * Android TV settings screen.
 *
 * Refresh notes: `refreshPlaylist` reports progress through `busy`, and the
 * list is disabled while any parse is running, because two concurrent parses of
 * the same provider is the fastest way to get a half-written playlist.
 */
import { useCallback, useRef, useState } from 'react';
import { PageHeader, PageEnd } from '@/components/layout/PageHeader';
import { AddPlaylistForm } from '@/components/playlist/AddPlaylistForm';
import { Button, IconButton } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { Input } from '@/components/common/Form';
import { EmptyState, InlineBanner } from '@/components/common/States';
import { Icon } from '@/components/common/Icon';
import { useDpadNavigation } from '@/hooks/useDpadNavigation';
import { usePersistentState } from '@/hooks/useMedia';
import {
  deletePlaylist,
  exportPlaylistM3U,
  refreshPlaylist,
  renamePlaylist,
  setDefaultPlaylist,
  setPlaylistParentOnly,
  useAppSelector,
} from '@/store/appStore';
import { formatCount, formatRelativeTime } from '@/utils/format';
import { adultRatio, isParentPlaylist } from '@/services/m3u/adult';
import type { PlaylistMeta } from '@/types';

type PendingAction = { kind: 'delete'; playlist: PlaylistMeta } | null;

export default function PlaylistsPage() {
  const playlists = useAppSelector((s) => s.playlists);
  const activeId = useAppSelector((s) => s.activePlaylistId);
  const parentPlaylistIds = useAppSelector((s) => s.parentPlaylistIds);
  const parentPlaylistId = useAppSelector((s) => s.parentPlaylistId);
  const parentControls = useAppSelector((s) => s.settings.parentControls);
  const busy = useAppSelector((s) => s.busy);
  const rootRef = useRef<HTMLDivElement>(null);
  const [formOpen, setFormOpen] = usePersistentState('ui:playlists:form', false);
  const [renameTarget, setRenameTarget] = useState<PlaylistMeta | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pending, setPending] = useState<PendingAction>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  useDpadNavigation(rootRef, { loop: false });

  const busyId = busy?.playlistId ?? null;
  const isBusy = busy !== null;

  const onRefresh = useCallback(
    async (playlist: PlaylistMeta) => {
      const ok = await refreshPlaylist(playlist.id);
      setLastResult(
        ok
          ? `“${playlist.name}” now has ${formatCount(playlist.itemCount)} entries.`
          : null,
      );
    },
    [],
  );

  const onRename = useCallback(() => {
    if (!renameTarget) return;
    renamePlaylist(renameTarget.id, renameValue);
    setRenameTarget(null);
  }, [renameTarget, renameValue]);

  return (
    <div ref={rootRef}>
      <PageHeader
        title="Playlists"
        subtitle={`${playlists.length} saved on this device`}
        actions={
          <Button icon={formOpen ? 'close' : 'plus'} onClick={() => setFormOpen(!formOpen)}>
            {formOpen ? 'Cancel' : 'Add'}
          </Button>
        }
      />

      {formOpen ? (
        <div className="mx-4 mb-6 rounded-2xl p-5 md:mx-8 surface-panel">
          <AddPlaylistForm />
        </div>
      ) : null}

      {lastResult ? (
        <div className="px-4 pb-4 md:px-8">
          <InlineBanner tone="success" message={lastResult} onDismiss={() => setLastResult(null)} />
        </div>
      ) : null}

      {isBusy && busy ? (
        <div className="px-4 pb-4 md:px-8">
          <InlineBanner
            tone="info"
            message={
              busy.progress
                ? `Refreshing “${busy.name}” — ${busy.progress.detail}`
                : `Fetching “${busy.name}”…`
            }
          />
        </div>
      ) : null}

      {playlists.length === 0 && !formOpen ? (
        <EmptyState
          icon="layers"
          title="No playlists saved"
          message="Add a playlist URL to load channels, movies and series."
          action={<Button icon="plus" onClick={() => setFormOpen(true)}>Add a playlist</Button>}
        />
      ) : (
        <ul className="space-y-2.5 px-4 pb-4 md:px-8">
          {playlists.map((playlist) => {
            const isActive = playlist.id === activeId;
            // Gated for the Parent page, so it is listed for refresh/rename/tag/
            // delete but must not be offered as something to browse with. Any
            // member of the reserved set counts, not just the one on show: a
            // second gated list is just as unreachable from the ordinary pages.
            const isParent = parentPlaylistIds.includes(playlist.id);
            // Auto-detected: mostly adult entries. A manual tag cannot switch
            // this off, so the control is disabled rather than hidden.
            const isDetected = isParentPlaylist(playlist);
            const isTagged = playlist.parentOnly === true;
            const isShowingHere = playlist.id === parentPlaylistId;
            const isThisBusy = busyId === playlist.id;
            return (
              <li key={playlist.id}>
                {/*
                  No `data-nav` on this wrapper. It is a `<div>`, so it matches
                  none of the focusable selectors and marking it did nothing —
                  the page had no reachable stop at all. The card's real actions
                  below carry the attribute instead, which is what a remote
                  should step through.
                */}
                <div
                  className={`surface-panel relative overflow-hidden rounded-2xl p-4 transition-[transform,border-color] duration-300 ${
                    isActive
                      ? 'border-accent-500/40'
                      : 'hover:-translate-y-0.5 hover:border-white/12'
                  }`}
                >
                  {/* The active playlist gets an accent-lit left edge, so which
                      one is in use is legible at a glance in a long list rather
                      than only from a small pill in the corner. */}
                  {isActive ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-accent-400 shadow-[0_0_10px_1px_rgb(var(--accent-400-rgb)/0.5)]"
                    />
                  ) : null}
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-mist-50">
                          {playlist.name}
                        </h2>
                        {isActive ? (
                          <span className="rounded-full bg-accent-500 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.12em] text-ink-1000 uppercase">
                            Active
                          </span>
                        ) : null}
                        {isParent ? (
                          <span className="rounded-full border border-live-500/40 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.12em] text-live-400 uppercase">
                            Parent only
                          </span>
                        ) : null}
                        {isShowingHere ? (
                          <span className="rounded-full bg-live-500/15 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.12em] text-live-300 uppercase">
                            Showing in Parent
                          </span>
                        ) : null}
                        {playlist.status === 'error' ? (
                          <span className="rounded-full border border-live-500/40 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.12em] text-live-400 uppercase">
                            Error
                          </span>
                        ) : null}
                      </div>

                      <p className="mt-1 truncate text-[11px] text-mist-500" title={playlist.url}>
                        {playlist.url}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mist-500">
                        <span className="tabular-nums">
                          {formatCount(playlist.itemCount)} entries
                        </span>
                        <span className="tabular-nums">
                          {formatCount(playlist.counts.live)} live
                        </span>
                        <span className="tabular-nums">
                          {formatCount(playlist.counts.movie)} movies
                        </span>
                        <span className="tabular-nums">
                          {formatCount(playlist.counts.series)} series
                        </span>
                        <span>Updated {formatRelativeTime(playlist.lastUpdated)}</span>
                      </div>

                      {playlist.error ? (
                        <p className="mt-2 text-[11px] text-live-400">{playlist.error}</p>
                      ) : null}

                      {/* Shown only while the feature is on, because a tag is
                          inert without it — a switched-off section is already
                          not rendering these entries anywhere. */}
                      {parentControls ? (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/6 pt-3">
                          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-mist-500">
                            <Icon name="lock" size={12} className="shrink-0" />
                            {isDetected ? (
                              <span>
                                Gated automatically —{' '}
                                {Math.round(adultRatio(playlist) * 100)}% of entries are adult
                              </span>
                            ) : isTagged ? (
                              <span>Tagged Parent only by you</span>
                            ) : (
                              <span>Keep this playlist behind the parental PIN</span>
                            )}
                          </span>
                          {isDetected ? null : (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon="lock"
                              data-nav
                              aria-pressed={isTagged}
                              onClick={() => void setPlaylistParentOnly(playlist.id, !isTagged)}
                            >
                              {isTagged ? 'Remove tag' : 'Tag Parent only'}
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {!isActive && !isParent ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          data-nav
                          onClick={() => setDefaultPlaylist(playlist.id)}
                          disabled={isBusy}
                        >
                          Use
                        </Button>
                      ) : null}
                      <IconButton
                        icon="refresh"
                        label={`Refresh ${playlist.name}`}
                        size="sm"
                        data-nav
                        onClick={() => void onRefresh(playlist)}
                        disabled={isBusy}
                        active={isThisBusy}
                      />
                      <IconButton
                        icon="download"
                        label={`Export ${playlist.name} as M3U`}
                        size="sm"
                        data-nav
                        onClick={() => {
                          const m3u = exportPlaylistM3U();
                          if (!m3u) return;
                          const blob = new Blob([m3u], { type: 'audio/x-mpegurl' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${playlist.name.replace(/[^a-z0-9]/gi, '_')}.m3u`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        disabled={isBusy || playlist.itemCount === 0}
                      />
                      <IconButton
                        icon="edit"
                        label={`Rename ${playlist.name}`}
                        size="sm"
                        data-nav
                        onClick={() => {
                          setRenameValue(playlist.name);
                          setRenameTarget(playlist);
                        }}
                      />
                      <IconButton
                        icon="trash"
                        label={`Delete ${playlist.name}`}
                        size="sm"
                        data-nav
                        onClick={() => setPending({ kind: 'delete', playlist })}
                      />
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="flex items-start gap-1.5 px-4 text-[11px] leading-relaxed text-mist-600 md:px-8">
        <Icon name="info" size={12} className="mt-0.5 shrink-0" />
        <span>
          Refreshing re-downloads and re-parses the playlist. Favourites and watch progress are
          keyed to entry identity, so they survive a refresh even if the provider reorders its
          list.
        </span>
      </p>

      {parentControls ? (
        <p className="flex items-start gap-1.5 px-4 pt-2 text-[11px] leading-relaxed text-mist-600 md:px-8">
          <Icon name="lock" size={12} className="mt-0.5 shrink-0" />
          <span>
            A Parent-only playlist is held out of Movies, Series, Live TV, Home and Search entirely,
            and appears on the Parent page once the PIN is entered. You can tag as many as you like;
            the Parent page shows one at a time and you pick which. A playlist that is mostly adult
            is gated on its own, and cannot be untagged.
          </span>
        </p>
      ) : null}

      <PageEnd />

      <Modal
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Rename playlist"
        description="Only the label changes. The source URL is untouched."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button onClick={onRename} disabled={renameValue.trim() === ''}>
              Save
            </Button>
          </>
        }
      >
        <Input
          label="Name"
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onRename();
          }}
          autoFocus
        />
      </Modal>

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Delete this playlist?"
        description={
          pending
            ? `“${pending.playlist.name}” and its ${formatCount(pending.playlist.itemCount)} cached entries will be removed from this device. The source URL is not changed anywhere.`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                if (pending) void deletePlaylist(pending.playlist.id);
                setPending(null);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-mist-400">
          Favourites and watch progress for its entries are kept, in case you add the playlist
          again later.
        </p>
      </Modal>
    </div>
  );
}
