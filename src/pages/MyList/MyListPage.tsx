/**
 * My List — favourites plus everything with a resume position.
 *
 * Both lists are read from the app store's `favoriteIds` / `progressById`, not
 * from a separate saved-list store: a favourite *is* a favourite, and keeping a
 * second copy is how the two drift apart.
 */
import { useCallback, useMemo, useRef } from 'react';
import { PageHeader, PageEnd, PageSection } from '@/components/layout/PageHeader';
import { SimpleGrid } from '@/components/cards/VirtualGrid';
import { EmptyState } from '@/components/common/States';
import { ButtonLink } from '@/components/common/Button';
import { useDpadNavigation } from '@/hooks/useDpadNavigation';
import { toggleFavorite, useAppSelector } from '@/store/appStore';
import { formatCount } from '@/utils/format';
import { ROUTES } from '@/utils/routes';
import type { ContentItem } from '@/types';

export default function MyListPage() {
  const items = useAppSelector((s) => s.items);
  const itemById = useAppSelector((s) => s.itemById);
  const favoriteIds = useAppSelector((s) => s.favoriteIds);
  const progressById = useAppSelector((s) => s.progressById);
  const rootRef = useRef<HTMLDivElement>(null);

  useDpadNavigation(rootRef, { loop: false });

  const favorites = useMemo(() => {
    const list: ContentItem[] = [];
    for (let i = 0; i < items.length; i++) {
      if (favoriteIds.has(items[i].id)) list.push(items[i]);
    }
    return list;
  }, [items, favoriteIds]);

  const continueWatching = useMemo(() => {
    const list: ContentItem[] = [];
    for (const entry of progressById.values()) {
      if (entry.percent <= 0.01 || entry.percent >= 0.97) continue;
      const item = itemById.get(entry.contentId);
      if (item) list.push(item);
    }
    return list.sort(
      (a, b) =>
        (progressById.get(b.id)?.updatedAt ?? 0) - (progressById.get(a.id)?.updatedAt ?? 0),
    );
  }, [progressById, itemById]);

  const onToggleFavorite = useCallback((item: ContentItem) => toggleFavorite(item), []);

  if (favorites.length === 0 && continueWatching.length === 0) {
    return (
      <div ref={rootRef}>
        <EmptyState
          icon="star"
          title="Nothing saved yet"
          message="Add something to My List from any card's plus button, and anything you start watching shows up here automatically."
          action={
            <ButtonLink to={ROUTES.home} icon="home">
              Browse the playlist
            </ButtonLink>
          }
        />
        <PageEnd />
      </div>
    );
  }

  return (
    <div ref={rootRef}>
      <PageHeader title="My List" subtitle="Saved on this device" />

      {continueWatching.length > 0 ? (
        <PageSection title={`Continue watching (${formatCount(continueWatching.length)})`}>
          {/* Poster, not `wide`: progress is never saved for live channels, so
              this list is all VOD, and a second card shape on the page left the
              two sections on different column counts. */}
          <SimpleGrid
            items={continueWatching}
            variant="poster"
            progressById={progressById}
            favoriteIds={favoriteIds}
            onToggleFavorite={onToggleFavorite}
          />
        </PageSection>
      ) : null}

      {favorites.length > 0 ? (
        <PageSection title={`Favourites (${formatCount(favorites.length)})`}>
          <SimpleGrid
            items={favorites}
            progressById={progressById}
            favoriteIds={favoriteIds}
            onToggleFavorite={onToggleFavorite}
          />
        </PageSection>
      ) : null}

      <PageEnd />
    </div>
  );
}
