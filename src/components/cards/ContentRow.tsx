/**
 * Horizontal content row.
 *
 * Scrolling is native (so trackpad, touch, and a TV remote's D-pad all work
 * for free), with arrow-key paging layered on top. Rows are rendered lazily:
 * `IntersectionObserver` only mounts the cards once the row is near the
 * viewport, which is what keeps the Home page cheap on a 50k-item playlist.
 *
 * `RowShell` owns the chrome — heading, gutter, gaps, paging arrows, lazy
 * mounting and the vertical rhythm — so every row on a page is spaced
 * identically. `ContentRow` is the playlist-entry flavour; a row of anything
 * else (series groups, for instance) uses `RowShell` directly rather than
 * re-implementing the same measurements in the page.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ContentItem, PlaybackProgress } from '@/types';
import { ContentCard } from './ContentCard';
import { Icon } from '@/components/common/Icon';
import { useDpadNavigation } from '@/hooks/useDpadNavigation';
import { useIsTouch, useIsTvLike } from '@/hooks/useMedia';

/** Anything the shell can key on. Both playlist entries and series groups have `id`. */
export interface RowItem {
  id: string;
}

export interface RowShellProps<T extends RowItem> {
  title: string;
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  href?: string;
  /** Rendered lazily; pass `true` for the row nearest the top of the page. */
  priority?: boolean;
  /** Position among the page's rows, used to cascade the entrance. */
  staggerIndex?: number;
}

/** Entrance stagger, capped so the tenth row is not still visibly arriving. */
const STAGGER_MS = 55;
const STAGGER_CAP = 6;

export function RowShell<T extends RowItem>({
  title,
  items,
  renderItem,
  href,
  priority = false,
  staggerIndex = 0,
}: RowShellProps<T>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(priority);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const isTouch = useIsTouch();
  const isTv = useIsTvLike();

  // Defer mounting until the row is close to the viewport.
  useEffect(() => {
    if (mounted) return;
    const node = sectionRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setMounted(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted]);

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const el = scrollerRef.current;
    if (!el) return;
    updateEdges();
    el.addEventListener('scroll', updateEdges, { passive: true });
    const observer = new ResizeObserver(updateEdges);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', updateEdges);
      observer.disconnect();
    };
  }, [mounted, updateEdges, items.length]);

  const page = useCallback((direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.88, behavior: 'smooth' });
  }, []);

  useDpadNavigation(sectionRef, { loop: true });

  if (items.length === 0) return null;

  // On touch there is nothing to hover, so the paging arrows are pure clutter.
  const showArrows = !isTouch && (isTv || !atStart || !atEnd);

  return (
    // The row owns its vertical rhythm (`mb-*` + `last:mb-0`) so the page below
    // does not have to think about spacing between rows.
    <section
      ref={sectionRef}
      className="animate-rise group/row relative mb-10 last:mb-0 md:mb-12"
      style={{ animationDelay: `${Math.min(staggerIndex, STAGGER_CAP) * STAGGER_MS}ms` }}
      aria-labelledby={`row-${title}`}
    >
      <div className="mb-4 flex items-end justify-between gap-4 px-4 md:px-8">
        <h2
          id={`row-${title}`}
          className="truncate text-[15px] font-semibold tracking-tight text-mist-50 md:text-base"
        >
          {href ? (
            <Link
              to={href}
              className="inline-flex items-center gap-1.5 rounded transition-colors hover:text-jade-300"
            >
              {title}
              <Icon
                name="chevron-right"
                size={16}
                className="opacity-0 transition-opacity group-hover/row:opacity-70"
              />
            </Link>
          ) : (
            title
          )}
        </h2>
        {href ? (
          <Link
            to={href}
            className="hidden shrink-0 items-center gap-1 text-xs font-medium text-mist-500 transition-colors hover:text-jade-300 sm:inline-flex"
          >
            Explore all
            <Icon name="chevron-right" size={13} />
          </Link>
        ) : null}
      </div>

      <div className="relative">
        <div
          ref={scrollerRef}
          className="row-scroll flex gap-3.5 overflow-x-auto scroll-smooth px-4 pb-2 md:gap-5 md:px-8"
        >
          {mounted
            ? items.map((item, i) => (
                <div key={item.id} className="shrink-0">
                  {renderItem(item, i)}
                </div>
              ))
            : null}
        </div>

        {showArrows ? (
          <>
            {!atStart ? (
              <button
                type="button"
                data-nav={false}
                onClick={() => page(-1)}
                aria-label={`Scroll ${title} left`}
                className="absolute top-1/2 -left-1 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-ink-600 bg-ink-900/90 text-mist-200 shadow-lift backdrop-blur transition-[color,background-color,transform] duration-200 hover:scale-105 hover:bg-ink-800 active:scale-95 md:flex"
              >
                <Icon name="chevron-left" size={20} />
              </button>
            ) : null}
            {!atEnd ? (
              <button
                type="button"
                data-nav={false}
                onClick={() => page(1)}
                aria-label={`Scroll ${title} right`}
                className="absolute top-1/2 -right-1 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-ink-600 bg-ink-900/90 text-mist-200 shadow-lift backdrop-blur transition-[color,background-color,transform] duration-200 hover:scale-105 hover:bg-ink-800 active:scale-95 md:flex"
              >
                <Icon name="chevron-right" size={20} />
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

export interface ContentRowProps {
  title: string;
  items: readonly ContentItem[];
  variant?: 'poster' | 'channel' | 'wide';
  href?: string;
  progressById?: ReadonlyMap<string, PlaybackProgress>;
  favoriteIds?: ReadonlySet<string>;
  onToggleFavorite?: (item: ContentItem) => void;
  priority?: boolean;
  staggerIndex?: number;
}

export const ContentRow = memo(function ContentRow({
  title,
  items,
  variant = 'poster',
  href,
  progressById,
  favoriteIds,
  onToggleFavorite,
  priority = false,
  staggerIndex = 0,
}: ContentRowProps) {
  // `emptyMessage` / `renderItem` are no longer part of this component's API: a
  // row of anything that is not a playlist entry uses `RowShell` directly.
  return (
    <RowShell
      title={title}
      items={items}
      href={href}
      priority={priority}
      staggerIndex={staggerIndex}
      renderItem={(item, i) => (
        <ContentCard
          item={item}
          variant={variant}
          progress={progressById?.get(item.id)}
          favorite={favoriteIds?.has(item.id) ?? false}
          onToggleFavorite={onToggleFavorite}
          index={i}
          total={items.length}
          priority={priority && i < 6}
        />
      )}
    />
  );
});
