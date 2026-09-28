/**
 * Playlist switcher.
 *
 * Switching must feel instant: the entries are already in IndexedDB, so this
 * only awaits a local read and a rebuild of the in-memory search index. No
 * network, no page reload — which is the behaviour the spec calls out
 * explicitly.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/common/Icon';
import { Spinner } from '@/components/common/Button';
import { activatePlaylist, useAppSelector } from '@/store/appStore';
import { ROUTES } from '@/utils/routes';
import { formatCount } from '@/utils/format';

export const PlaylistSwitcher = memo(function PlaylistSwitcher() {
  const playlists = useAppSelector((s) => s.playlists);
  const activeId = useAppSelector((s) => s.activePlaylistId);
  const busy = useAppSelector((s) => s.busy);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const active = playlists.find((p) => p.id === activeId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const select = useCallback(
    (id: string) => {
      setOpen(false);
      if (id === activeId) return;
      void activatePlaylist(id);
    },
    [activeId],
  );

  if (playlists.length === 0) {
    return (
      <button
        type="button"
        onClick={() => navigate(ROUTES.playlists)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-ink-600 bg-ink-850 px-2.5 text-xs font-medium text-mist-200 transition-colors hover:border-jade-600 hover:text-mist-50"
      >
        <Icon name="plus" size={14} />
        <span className="hidden sm:inline">Add playlist</span>
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        data-nav
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Current playlist: ${active?.name ?? 'None'}. Change playlist`}
        className="inline-flex h-8 max-w-[9.5rem] items-center gap-1.5 rounded-md border border-ink-600 bg-ink-850 pl-2.5 pr-2 text-xs font-medium text-mist-200 transition-colors hover:border-ink-500 hover:text-mist-50 md:max-w-none"
      >
        {busy ? <Spinner size={13} /> : null}
        <span className="truncate">{active?.name ?? 'Select playlist'}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={13} className="text-mist-500" />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Playlists"
          className="animate-scale-in absolute right-0 z-50 mt-1.5 w-72 origin-top-right overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-lift"
        >
          <ul className="max-h-72 overflow-y-auto py-1">
            {playlists.map((playlist) => {
              const selected = playlist.id === activeId;
              return (
                <li key={playlist.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-nav
                    onClick={() => select(playlist.id)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                      selected ? 'bg-ink-750' : 'hover:bg-ink-800'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        selected ? 'bg-jade-400' : 'bg-ink-600'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-mist-50">{playlist.name}</span>
                      <span className="block truncate text-[11px] text-mist-500">
                        {playlist.status === 'ready'
                          ? `${formatCount(playlist.itemCount)} items`
                          : playlist.status}
                      </span>
                    </span>
                    {selected ? <Icon name="check" size={15} className="text-jade-400" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-ink-700 p-1.5">
            <button
              type="button"
              data-nav
              onClick={() => {
                setOpen(false);
                navigate(ROUTES.playlists);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs font-medium text-mist-300 transition-colors hover:bg-ink-800 hover:text-mist-50"
            >
              <Icon name="settings" size={14} />
              Manage playlists
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
});
