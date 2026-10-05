/**
 * Shared browse surface for the Movies / Series / Live TV pages.
 *
 * All three are the same shape — a title, a filter bar, and a virtualised grid —
 * so they share one implementation and differ only in `kind` and card variant.
 * The pages themselves stay thin, which is what keeps the navigation model
 * identical across the app.
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ContentItem } from '@/types';
import { PageHeader, PageEnd, PageSection } from './PageHeader';
import { FilterBar } from './FilterBar';
import { VirtualGrid } from '@/components/cards/VirtualGrid';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/States';
import { useDpadNavigation } from '@/hooks/useDpadNavigation';
import { useFilters } from '@/hooks/useFilters';
import { toggleFavorite, useAppSelector } from '@/store/appStore';
import { formatCount } from '@/utils/format';
import type { SortKey } from '@/utils/filters';

export interface CatalogPageProps {
  kind: ContentItem['kind'];
  title: string;
  subtitle?: string;
  variant?: 'poster' | 'channel';
  /** Incrementally grow the visible window instead of virtualising everything. */
  pageSize?: number;
  showSort?: boolean;
  showFavorites?: boolean;
  /**
   * Order used until the visitor picks another. Movies pass `'year'` so the
   * newest releases lead; live channels keep A–Z because a channel has no year.
   */
  defaultSort?: SortKey;
  emptyTitle: string;
  emptyMessage: string;
  /**
   * Entries to withhold from this surface. Live TV passes the channels recorded
   * as failing to play, so a broken channel costs nothing to browse past.
   */
  excludeIds?: ReadonlySet<string>;
  /** Rendered under the title and above the filters — e.g. a hiding notice. */
  notice?: ReactNode;
}

export const CatalogPage = memo(function CatalogPage({
  kind,
  title,
  subtitle,
  variant = 'poster',
  pageSize = 1200,
  showSort = true,
  showFavorites = true,
  defaultSort = 'title',
  emptyTitle,
  emptyMessage,
  excludeIds,
  notice,
}: CatalogPageProps) {
  const kinds = useMemo(() => new Set<ContentItem['kind']>([kind]), [kind]);
  const { filters, setFilter, clearAll, hasActive, result, progressById, favoriteIds } =
    useFilters({ kinds, defaultSort, excludeIds });
  const itemCount = useAppSelector((s) => s.items.length);
  const rootRef = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(pageSize);
  const [params] = useSearchParams();
  const [headerVisible, setHeaderVisible] = useState(true);
  const lastScrollY = useRef(0);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A different kind of view (Home → Movies) resets the growth window.
  const scopeKey = `${kind}:${params.toString()}`;
  const lastScope = useRef(scopeKey);
  if (lastScope.current !== scopeKey) {
    lastScope.current = scopeKey;
    if (limit !== pageSize) setLimit(pageSize);
  }

  useDpadNavigation(rootRef, { loop: false });

  // Track scroll direction to auto-hide header and filters
  const handleGridScroll = useCallback(
    (scrollTop: number) => {
      if (scrollTop > lastScrollY.current + 10) {
        // Scrolling down - hide header
        setHeaderVisible(false);
      } else if (scrollTop < lastScrollY.current - 10) {
        // Scrolling up - show header
        setHeaderVisible(true);
      }
      lastScrollY.current = scrollTop;
    },
    [],
  );

  const visible = useMemo(
    () => (result.length > limit ? result.slice(0, limit) : result),
    [result, limit],
  );

  const onToggleFavorite = useCallback((item: ContentItem) => toggleFavorite(item), []);
  const onEndReached = useCallback(() => {
    setLimit((current) => (current >= result.length ? current : current + pageSize));
  }, [result.length, pageSize]);

  const resetKey = `${kind}:${filters.group}:${filters.language}:${filters.country}:${filters.sort}:${filters.favoriteOnly}`;

  return (
    <div ref={rootRef}>
      <div
        className={`transition-all duration-300 ease-out ${
          headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'
        }`}
      >
        <PageHeader
          title={title}
          subtitle={
            subtitle ?? (
              <>
                {formatCount(result.length)}
                {result.length !== itemCount ? ' of ' : ' '}
                {hasActive ? 'entries match' : 'entries'}
              </>
            )
          }
        >
          {notice}
        </PageHeader>

        <FilterBar
          filters={filters}
          hasActive={hasActive}
          scope={kind}
          showSort={showSort}
          showFavorites={showFavorites}
          onChange={setFilter}
          onClear={clearAll}
        />
      </div>

      {result.length === 0 ? (
        <EmptyState
          // Keyed to `kind`, not `variant`: Live TV renders poster cards now, but
          // its empty state is still about television, and reading the icon off
          // the card variant gave it a film glyph.
          icon={kind === 'live' ? 'tv' : 'film'}
          title={emptyTitle}
          message={hasActive ? 'No entries match the current filters.' : emptyMessage}
          action={
            hasActive ? (
              <Button variant="secondary" icon="close" onClick={clearAll}>
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : (
        <PageSection>
          <VirtualGrid
            items={visible}
            variant={variant}
            progressById={progressById}
            favoriteIds={favoriteIds}
            onToggleFavorite={onToggleFavorite}
            onEndReached={onEndReached}
            onScroll={handleGridScroll}
            resetKey={resetKey}
            className="max-h-[calc(100dvh-13rem)]"
          />
          {limit < result.length ? (
            <p className="px-4 py-4 text-center text-xs text-mist-500 md:px-8">
              Showing {formatCount(visible.length)} of {formatCount(result.length)} — scroll to load
              more
            </p>
          ) : null}
        </PageSection>
      )}

      <PageEnd />
    </div>
  );
});
