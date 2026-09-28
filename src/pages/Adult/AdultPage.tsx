/**
 * Parent — the gated section.
 *
 * Where the content comes from, in priority order:
 *
 *   1. A playlist reserved for this page: one the parent tagged by hand, or one
 *      whose entries are predominantly adult (`services/m3u/adult.ts`). Any
 *      number of playlists can be reserved at once, and none of them is reachable
 *      from the Movies, Series, Live, Home or My List pages.
 *   2. Failing that, the adult entries inside whatever playlist is active. Mixed
 *      playlists are common, and a handful of `XXX` entries should still end up
 *      here rather than on the ordinary pages.
 *
 * Only one reserved playlist is loaded at a time. The entries are read in full
 * from IndexedDB into `parentItems`, so showing several at once would mean
 * holding every gated playlist in memory and rendering a grid whose titles have
 * no single source playlist. The picker below swaps one for the other.
 *
 * Four states, and the order matters:
 *
 *   - Controls switched off — nothing to unlock, so say so rather than silently
 *     showing everything.
 *   - Locked — the PIN prompt opens immediately and **the grid is not rendered at
 *     all**. Rendering it behind the prompt would put every title in the DOM (and
 *     in the page's accessible name) for anyone who inspects it, which defeats
 *     the point.
 *   - Unlocked — the content, newest first.
 *
 * Unlock lives in memory only (`store/adultGate`), so a reload re-locks.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader, PageEnd } from '@/components/layout/PageHeader';
import { VirtualGrid } from '@/components/cards/VirtualGrid';
import { EmptyState } from '@/components/common/States';
import { ButtonLink, Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { PinDialog } from '@/components/common/PinDialog';
import { useDpadNavigation } from '@/hooks/useDpadNavigation';
import { selectParentPlaylist, toggleFavorite, useAppSelector } from '@/store/appStore';
import { lockAdult, unlockAdult, useAdultUnlocked } from '@/store/adultGate';
import { adultOnly } from '@/services/m3u/adult';
import { formatCount } from '@/utils/format';
import { ROUTES } from '@/utils/routes';
import type { ContentItem } from '@/types';

export default function AdultPage() {
  const items = useAppSelector((s) => s.items);
  const parentItems = useAppSelector((s) => s.parentItems);
  const parentPlaylistId = useAppSelector((s) => s.parentPlaylistId);
  const parentPlaylistIds = useAppSelector((s) => s.parentPlaylistIds);
  const playlists = useAppSelector((s) => s.playlists);
  const progressById = useAppSelector((s) => s.progressById);
  const favoriteIds = useAppSelector((s) => s.favoriteIds);
  const parentControls = useAppSelector((s) => s.settings.parentControls);
  const unlocked = useAdultUnlocked();
  const rootRef = useRef<HTMLDivElement>(null);

  // Only prompt while the feature is on and something is actually locked.
  const [promptOpen, setPromptOpen] = useState(false);
  useDpadNavigation(rootRef, { loop: false });

  // The reserved playlist wins outright. A dedicated list is what the user asked
  // for, so it is shown whole rather than filtered down to its adult entries.
  const content = useMemo<ContentItem[]>(() => {
    if (parentPlaylistId && parentItems.length > 0) return parentItems;
    return adultOnly(items);
  }, [parentPlaylistId, parentItems, items]);

  const hasContent = content.length > 0;
  const parentPlaylist = parentPlaylistId
    ? playlists.find((p) => p.id === parentPlaylistId)
    : undefined;
  // Resolved in the order the store ranked them, so the picker matches the order
  // the Parent page falls back through.
  const reserved = useMemo(
    () =>
      parentPlaylistIds
        .map((id) => playlists.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => p !== undefined),
    [parentPlaylistIds, playlists],
  );

  // Newest first, matching Movies. Undated entries fall to the end.
  const sorted = useMemo(() => {
    const out = [...content];
    out.sort((a, b) => (b.year ?? -1) - (a.year ?? -1) || a.name.localeCompare(b.name));
    return out;
  }, [content]);

  // Ask for the PIN on arrival, so reaching this page by URL or history button
  // still goes through the prompt rather than showing a bare lock screen.
  useEffect(() => {
    if (parentControls && hasContent && !unlocked) setPromptOpen(true);
  }, [parentControls, hasContent, unlocked]);

  return (
    <div ref={rootRef}>
      <PageHeader
        title="Parent"
        subtitle={
          parentPlaylist && parentPlaylistId
            ? `Gated content from ${parentPlaylist.name}`
            : 'Gated content'
        }
      />

      {/* Only once unlocked: the playlist names are themselves a small leak, and
          there is nothing to switch between until the section is open. Sits above
          the states so it also stays reachable when the list on show is empty. */}
      {unlocked && reserved.length > 1 ? (
        <div className="mx-4 mb-4 md:mx-8">
          <p className="mb-2 text-[10px] font-semibold tracking-[0.14em] text-mist-500 uppercase">
            Gated playlists
          </p>
          <div className="flex flex-wrap gap-2">
            {reserved.map((playlist) => {
              const current = playlist.id === parentPlaylistId;
              return (
                <button
                  key={playlist.id}
                  type="button"
                  data-nav
                  aria-pressed={current}
                  onClick={() => void selectParentPlaylist(playlist.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    current
                      ? 'border-accent-500/50 bg-accent-500/15 text-mist-50'
                      : 'border-white/10 bg-ink-850/60 text-mist-300 hover:border-white/20 hover:text-mist-50'
                  }`}
                >
                  {current ? <Icon name="check" size={13} className="text-accent-400" /> : null}
                  <span className="max-w-[14rem] truncate">{playlist.name}</span>
                  <span className="text-[11px] text-mist-500 tabular-nums">
                    {formatCount(playlist.itemCount)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {!parentControls ? (
        <EmptyState
          icon="lock"
          title="Parental controls are off"
          message="Turn on parental controls in Settings to hold adult content back behind a PIN and collect it here."
          action={
            <ButtonLink to={ROUTES.settings} variant="primary">
              Open Settings
            </ButtonLink>
          }
        />
      ) : !hasContent ? (
        <EmptyState
          icon="lock"
          title="Nothing here yet"
          message={
            parentPlaylistId
              ? 'The playlist on show here could not be read. Open Playlists to refresh it, or pick another gated playlist.'
              : 'No entries in your playlists are filed under a group this player recognises as 18+. Groups such as “XXX”, “Adult” or “18+” are picked up automatically, and a playlist where most entries are adult is gated on its own. If your provider labels nothing at all, open Playlists and tag one Parent only by hand.'
          }
          action={
            <ButtonLink to={ROUTES.playlists} variant="primary">
              Open Playlists
            </ButtonLink>
          }
        />
      ) : !unlocked ? (
        <EmptyState
          icon="lock"
          title="Locked"
          message={`${formatCount(content.length)} entr${content.length === 1 ? 'y is' : 'ies are'} held back behind the parental PIN.`}
          action={
            <Button variant="primary" icon="lock-open" onClick={() => setPromptOpen(true)}>
              Enter PIN
            </Button>
          }
        />
      ) : (
        <VirtualGrid
          items={sorted}
          variant="poster"
          progressById={progressById}
          favoriteIds={favoriteIds}
          onToggleFavorite={toggleFavorite}
          resetKey={`parent:${parentPlaylistId ?? 'mixed'}:${sorted.length}`}
        />
      )}

      <PinDialog
        open={parentControls && !unlocked && hasContent && promptOpen}
        onUnlocked={() => {
          setPromptOpen(false);
          unlockAdult();
        }}
        onCancel={() => setPromptOpen(false)}
      />

      {unlocked ? (
        <div className="flex justify-center px-4 pb-6">
          <Button variant="ghost" icon="lock" onClick={lockAdult}>
            Lock section
          </Button>
        </div>
      ) : null}

      <PageEnd />
    </div>
  );
}
