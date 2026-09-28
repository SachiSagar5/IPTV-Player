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
  refreshPlaylist,
  renamePlaylist,
  setDefaultPlaylist,
  useAppSelector,
} from '@/store/appStore';
import { formatCount, formatRelativeTime } from '@/utils/format';
import type { PlaylistMeta } from '@/types';

type PendingAction = { kind: 'delete'; playlist: PlaylistMeta } | null;

export default function PlaylistsPage() {
  const playlists = useAppSelector((s) => s.playlists);
  const activeId = useAppSelector((s) => s.activePlaylistId);
  const parentPlaylistId = useAppSelector((s) => s.parentPlaylistId);
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
        <div className="mx-4 mb-6 rounded-xl border border-ink-700 bg-ink-900 p-5 md:mx-8">
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
            // Reserved for the Parent page, so it is listed for refresh/rename/
            // delete but must not be offered as something to browse with.
            const isParent = playlist.id === parentPlaylistId;
            const isThisBusy = busyId === playlist.id;
            return (
              <li key={playlist.id}>
                <div
                  data-nav
                  className={`rounded-xl border p-4 transition-colors ${
                    isActive
                      ? 'border-jade-600/50 bg-jade-500/6'
                      : 'border-ink-700 bg-ink-900 hover:border-ink-600'
                  }`}
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-mist-50">
                          {playlist.name}
                        </h2>
                        {isActive ? (
                          <span className="rounded-full bg-jade-500 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.12em] text-ink-1000 uppercase">
                            Active
                          </span>
                        ) : null}
                        {isParent ? (
                          <span className="rounded-full border border-live-500/40 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.12em] text-live-400 uppercase">
                            Parent only
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
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {!isActive && !isParent ? (
                        <Button
                          size="sm"
                          variant="secondary"
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
                        onClick={() => void onRefresh(playlist)}
                        disabled={isBusy}
                        active={isThisBusy}
                      />
                      <IconButton
                        icon="edit"
                        label={`Rename ${playlist.name}`}
                        size="sm"
                        onClick={() => {
                          setRenameValue(playlist.name);
                          setRenameTarget(playlist);
                        }}
                      />
                      <IconButton
                        icon="trash"
                        label={`Delete ${playlist.name}`}
                        size="sm"
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
