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
          className="flex min-w-0 items-center gap-3 text-[15px] font-semibold tracking-tight text-mist-50 md:text-lg"
        >
          {/* Short accent rule: gives each row a consistent left anchor so the
              page reads as a stack of sections rather than a list of strings. */}
          <span
            aria-hidden="true"
            className="rule-accent h-4 w-1 shrink-0 rounded-full transition-[height] duration-300 group-hover/row:h-5"
          />
          {href ? (
            <Link
              to={href}
              className="inline-flex min-w-0 items-center gap-1.5 rounded transition-colors hover:text-accent-300"
            >
              <span className="truncate">{title}</span>
              <Icon
                name="chevron-right"
                size={16}
                className="shrink-0 opacity-0 transition-opacity group-hover/row:opacity-70"
              />
            </Link>
          ) : (
            <span className="truncate">{title}</span>
          )}
        </h2>
        {href ? (
          <Link
            to={href}
            className="group/all hidden shrink-0 items-center gap-1 rounded-full border border-ink-700 bg-ink-900/70 py-1 pr-1.5 pl-3 text-xs font-medium text-mist-400 backdrop-blur-sm transition-colors hover:border-accent-600/60 hover:text-accent-300 sm:inline-flex"
          >
            Explore all
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-750 transition-colors group-hover/all:bg-accent-500/20">
              <Icon name="chevron-right" size={12} />
            </span>
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

        {/* Soft masks so a row bleeds off the gutter instead of ending on a
            hard vertical edge. Applied to an overlay rather than the scroller
            itself, because masking the scrolling element also fades the cards
            while they are moving, which looks like a rendering fault. */}
        {!atStart ? (
          <div
            aria-hidden="true"
            className="edge-fade-left pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-l from-ink-950 to-transparent md:w-16"
          />
        ) : null}
        {!atEnd ? (
          <div
            aria-hidden="true"
            className="edge-fade-right pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-r from-ink-950 to-transparent md:w-16"
          />
        ) : null}

        {showArrows ? (
          <>
            {!atStart ? (
              <button
                type="button"
                data-nav={false}
                onClick={() => page(-1)}
                aria-label={`Scroll ${title} left`}
                className="absolute top-1/2 -left-1 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-ink-900/85 text-mist-100 shadow-lift backdrop-blur-md transition-[color,background-color,transform] duration-200 hover:scale-105 hover:border-accent-500/50 hover:bg-ink-800 hover:text-accent-300 active:scale-95 md:flex"
              >
                <Icon name="chevron-left" size={22} />
              </button>
            ) : null}
            {!atEnd ? (
              <button
                type="button"
                data-nav={false}
                onClick={() => page(1)}
                aria-label={`Scroll ${title} right`}
                className="absolute top-1/2 -right-1 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-ink-900/85 text-mist-100 shadow-lift backdrop-blur-md transition-[color,background-color,transform] duration-200 hover:scale-105 hover:border-accent-500/50 hover:bg-ink-800 hover:text-accent-300 active:scale-95 md:flex"
              >
                <Icon name="chevron-right" size={22} />
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
