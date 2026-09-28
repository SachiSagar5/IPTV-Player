/**
 * Parent — the gated section.
 *
 * Where the content comes from, in priority order:
 *
 *   1. The reserved Parent playlist, if one was detected. A playlist whose
 *      entries are predominantly adult (`services/m3u/adult.ts`) is pulled out of
 *      ordinary browsing entirely and loaded here instead, so it is never on the
 *      Movies, Series, Live, Home or My List pages.
 *   2. Failing that, the adult entries inside whatever playlist is active. Mixed
 *      playlists are common, and a handful of `XXX` entries should still end up
 *      here rather than on the ordinary pages.
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
import { PinDialog } from '@/components/common/PinDialog';
import { useDpadNavigation } from '@/hooks/useDpadNavigation';
import { toggleFavorite, useAppSelector } from '@/store/appStore';
import { lockAdult, unlockAdult, useAdultUnlocked } from '@/store/adultGate';
import { adultOnly } from '@/services/m3u/adult';
import { formatCount } from '@/utils/format';
import { ROUTES } from '@/utils/routes';
import type { ContentItem } from '@/types';

export default function AdultPage() {
  const items = useAppSelector((s) => s.items);
  const parentItems = useAppSelector((s) => s.parentItems);
  const parentPlaylistId = useAppSelector((s) => s.parentPlaylistId);
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
              ? 'The reserved Parent playlist could not be read. Open Playlists to refresh it.'
              : 'No entries in your playlists are filed under a group this player recognises as 18+. Groups such as “XXX”, “Adult” or “18+” are picked up automatically, and a playlist where most entries are adult is reserved for this page on its own.'
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
