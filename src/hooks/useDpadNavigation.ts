/**
 * D-pad / arrow-key navigation.
 *
 * The app is web-first, but every interactive element must already be reachable
 * with arrows + Enter, because that is the only input model Android TV and
 * Fire TV have. Rather than sprinkling key handlers on every component, this
 * hook attaches one delegated listener per container and moves focus spatially:
 *
 *   ← →   previous / next item in the same visual row
 *   ↑ ↓   nearest item in the row above / below (by horizontal centre)
 *   Home  first item      End  last item
 *
 * Candidates are the elements carrying `data-nav`, which every card, chip and
 * control sets. Only *mounted* elements are considered, so a virtualised grid
 * costs the same as a 20-item row.
 *
 * Containers nest (the shell contains a page, which contains a grid), and
 * `keydown` bubbles from the innermost outwards. The innermost container that
 * actually moves focus calls `preventDefault()`, and every outer container
 * bails on that, so one D-pad press moves focus exactly once. An outer
 * container only gets a turn when the inner one ran out of candidates, which is
 * precisely when "step out to the parent context" is the right thing to do.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { navCandidates } from './navCandidates';

export interface NavigationOptions {
  /** Fired on Escape / Back. */
  onEscape?: () => void;
  /** Wrap around at the ends of a row. */
  loop?: boolean;
  enabled?: boolean;
  /** Called when focus leaves the container entirely. */
  onExit?: () => void;
}

const ROW_TOLERANCE = 0.6;

export function useDpadNavigation<T extends HTMLElement>(
  ref: RefObject<T | null>,
  options: NavigationOptions = {},
): void {
  const { loop = true, enabled = true, onExit } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // A nested container already resolved this press. See the module comment.
      if (event.defaultPrevented) return;

      const container = ref.current;
      if (!container) return;

      const active = document.activeElement as HTMLElement | null;
      if (!active || !container.contains(active)) return;

      const isArrow =
        event.key === 'ArrowRight' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown';
      const isHomeEnd = event.key === 'Home' || event.key === 'End';

      if (event.key === 'Escape') {
        if (optionsRef.current.onEscape) {
          event.preventDefault();
          optionsRef.current.onEscape();
        }
        return;
      }

      if (!isArrow && !isHomeEnd) return;
      // Let inputs and selects keep their native caret behaviour.
      if (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        active.isContentEditable
      ) {
        return;
      }

      const candidates = navCandidates(container);

      if (candidates.length === 0) return;

      const currentIndex = candidates.indexOf(active);
      if (currentIndex === -1) return;

      if (isHomeEnd) {
        event.preventDefault();
        const target = event.key === 'Home' ? candidates[0] : candidates[candidates.length - 1];
        target.focus();
        // Home/End are the "jump to the far end" keys, so the target is usually
        // off-screen: without this they would be focused but never scrolled to.
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return;
      }

      const currentRect = active.getBoundingClientRect();
      const currentCx = currentRect.left + currentRect.width / 2;
      const currentCy = currentRect.top + currentRect.height / 2;

      let best: HTMLElement | null = null;
      let bestScore = Number.POSITIVE_INFINITY;

      for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i];
        if (el === active) continue;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dy = cy - currentCy;
        const dx = cx - currentCx;

        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          // Same row: vertical centres must be within half a card height.
          if (Math.abs(dy) > Math.max(rect.height, currentRect.height) * ROW_TOLERANCE) continue;
          const forward = event.key === 'ArrowRight' ? dx > 0 : dx < 0;
          if (!forward) continue;
          const distance = Math.abs(dx);
          if (distance < bestScore) {
            bestScore = distance;
            best = el;
          }
        } else {
          const wanted = event.key === 'ArrowDown' ? dy > 0 : dy < 0;
          if (!wanted) continue;
          // Prefer the closest row, then the closest horizontal centre.
          const score = Math.abs(dy) * 2 + Math.abs(dx);
          if (score < bestScore) {
            bestScore = score;
            best = el;
          }
        }
      }

      if (best) {
        event.preventDefault();
        best.focus();
        best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return;
      }

      // Reached an edge. Loop within the row, or hand control back to the page.
      if (loop && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        const sameRow = candidates.filter((el) => {
          const rect = el.getBoundingClientRect();
          return (
            Math.abs(rect.top + rect.height / 2 - currentCy) <=
            Math.max(rect.height, currentRect.height) * ROW_TOLERANCE
          );
        });
        if (sameRow.length > 1) {
          event.preventDefault();
          const target =
            event.key === 'ArrowRight' ? sameRow[0] : sameRow[sameRow.length - 1];
          target.focus();
          target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          return;
        }
      }

      if (onExit) onExit();
    },
    [ref, loop, onExit],
  );

  useEffect(() => {
    const container = ref.current;
    if (!enabled || !container) return;
    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [ref, enabled, handleKeyDown]);
}

/**
 * Scroll a horizontal row so a newly focused card is fully visible.
 * Rows use `scrollIntoView`, but on nested scroll containers that can drag the
 * page; this only adjusts the row itself.
 */
export function useRowScrollRef() {
  const ref = useRef<HTMLDivElement>(null);
  return ref;
}
