/**
 * Virtualised poster grid.
 *
 * Required because a provider playlist routinely has 5,000+ channels or movies
 * and rendering 5,000 React cards is ~200k DOM nodes — which is exactly the
 * "large lists are optimised" acceptance criterion.
 *
 * Implementation choice: `@tanstack/react-virtual` in rows mode. Rows (not
 * items) are the unit because the grid is responsive: the column count changes
 * with the viewport, so recomputing columns on resize and re-measuring one row
 * height is far cheaper than tracking 500 item positions.
 */
import { memo, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ContentItem, PlaybackProgress } from '@/types';
import { ContentCard } from './ContentCard';
import { useDpadNavigation } from '@/hooks/useDpadNavigation';
import { useViewportWidth } from '@/hooks/useMedia';

/**
 * Column counts per breakpoint, per card variant.
 *
 * These used to be a single width-only table shared by every variant, which is
 * why grid cards overlapped: at `lg` a poster column is ~150px wide but the card
 * was pinned to 190px, so every card after the first covered its neighbour. Each
 * variant now gets a count that actually fits the card's own design width
 * (`SIZES` in `ContentCard`), and cards stretch to fill the cell, so the grid
 * ends flush at the right edge at every width.
 */
type Variant = 'poster' | 'channel' | 'wide';

function columnsForWidth(width: number, variant: Variant): number {
  const tier =
    width < 640 ? 0 : width < 768 ? 1 : width < 1024 ? 2 : width < 1280 ? 3 : width < 1536 ? 4 : 5;
  return COLUMN_TABLE[variant][tier];
}

/** Index order: base, sm(640), md(768), lg(1024), xl(1280), 2xl(1536). */
const COLUMN_TABLE: Record<Variant, readonly number[]> = {
  // Card widths: 132 / 164 / 190.
  poster: [2, 3, 4, 5, 6, 7],
  // Channel logos are small squares: 104 / 124 / 142.
  channel: [3, 5, 6, 7, 9, 10],
  // 16:9 cards are much wider: 200 / 248 / 288.
  wide: [1, 2, 3, 3, 4, 5],
};

/** Row-height estimates, used before a row has been measured. */
const ROW_ESTIMATE: Record<Variant, number> = {
  poster: 330,
  channel: 190,
  wide: 240,
};

const GAP = 12;

export interface VirtualGridProps {
  items: readonly ContentItem[];
  variant?: Variant;
  progressById?: ReadonlyMap<string, PlaybackProgress>;
  favoriteIds?: ReadonlySet<string>;
  onToggleFavorite?: (item: ContentItem) => void;
  emptyMessage?: string;
  onEndReached?: () => void;
  /** Scrolls to the top when this changes — used on filter changes. */
  resetKey?: string;
  className?: string;
}

export const VirtualGrid = memo(function VirtualGrid({
  items,
  variant = 'poster',
  progressById,
  favoriteIds,
  onToggleFavorite,
  onEndReached,
  resetKey,
  className = '',
}: VirtualGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const width = useViewportWidth();
  const columns = columnsForWidth(width, variant);

  const rowCount = Math.ceil(items.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    // Cards now stretch to fill their column, so a row's height depends on the
    // viewport. Rows are measured with `measureElement` below; this is only the
    // pre-measure guess.
    estimateSize: () => ROW_ESTIMATE[variant],
    overscan: 3,
    gap: 20,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  // Reset scroll position when the filter set changes.
  const lastResetKey = useRef(resetKey);
  if (resetKey !== undefined && lastResetKey.current !== resetKey) {
    lastResetKey.current = resetKey;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    rowVirtualizer.scrollToOffset(0);
  }

  const handleEndReached = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 600) onEndReached?.();
  }, [onEndReached]);

  useDpadNavigation(gridRef, { loop: false });

  if (items.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      onScroll={handleEndReached}
      className={`relative overflow-y-auto ${className}`}
      // Never widen this to `contain: strict` (or `content`): those imply
      // `contain: size`, and this box is `height: auto` with only a max-height,
      // so size containment resolves its height to 0px and hides every card.
      // Measured in Chrome: clientHeight 0px with `strict`, 605px with this.
      style={{ contain: 'layout paint' }}
    >
      <div
        ref={gridRef}
        role="list"
        className="px-4 md:px-8"
        style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}
      >
        {virtualRows.map((virtualRow) => {
          const start = virtualRow.index * columns;
          const rowItems = items.slice(start, start + columns);
          return (
            <div
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              role="listitem"
              className="absolute inset-x-0 top-0 grid"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                columnGap: GAP,
              }}
            >
              {rowItems.map((item, columnIndex) => (
                <ContentCard
                  key={item.id}
                  item={item}
                  variant={variant}
                  fill
                  progress={progressById?.get(item.id)}
                  favorite={favoriteIds?.has(item.id) ?? false}
                  onToggleFavorite={onToggleFavorite}
                  index={start + columnIndex}
                  total={items.length}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
});

/**
 * Static grid for small, bounded sets (favourites, search results, a season's
 * episodes). Virtualising under ~200 items costs more than it saves.
 */
export const SimpleGrid = memo(function SimpleGrid({
  items,
  variant = 'poster',
  progressById,
  favoriteIds,
  onToggleFavorite,
  showEpisodeMeta = false,
  className = '',
}: Omit<VirtualGridProps, 'onEndReached' | 'resetKey'> & { showEpisodeMeta?: boolean }) {
  const gridRef = useRef<HTMLDivElement>(null);
  useDpadNavigation(gridRef, { loop: false });
  if (items.length === 0) return null;

  // Mirrors `COLUMN_TABLE` above, expressed as classes so the breakpoints come
  // from Tailwind rather than a hand-maintained pixel table.
  const columnsClass = {
    poster: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
    channel: 'grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-9',
    wide: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4',
  }[variant];

  return (
    <div
      ref={gridRef}
      role="list"
      className={`grid gap-3 px-4 md:px-8 ${columnsClass} ${className}`}
    >
      {items.map((item, i) => (
        <div key={item.id} role="listitem" className="min-w-0">
          <ContentCard
            item={item}
            variant={variant}
            fill
            progress={progressById?.get(item.id)}
            favorite={favoriteIds?.has(item.id) ?? false}
            onToggleFavorite={onToggleFavorite}
            showEpisodeMeta={showEpisodeMeta}
            index={i}
            total={items.length}
          />
        </div>
      ))}
    </div>
  );
});
