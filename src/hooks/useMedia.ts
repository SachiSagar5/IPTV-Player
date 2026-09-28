/** Small, dependency-free hooks used across the app. */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Latest-value ref, for reading fresh state inside long-lived callbacks. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Debounced mirror of a value. Used for the search box so a fast typist issues
 * one query instead of one per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 180): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (value === debounced) return;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs, debounced]);
  return debounced;
}

/** `matchMedia` as reactive state. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent): void => setMatches(event.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export const useIsMobile = (): boolean => useMediaQuery('(max-width: 767px)');
export const useIsTouch = (): boolean => useMediaQuery('(hover: none)');
/** "Rough TV" heuristic: a large viewport with no fine pointer. */
export const useIsTvLike = (): boolean =>
  useMediaQuery('(min-width: 1280px) and (hover: none) and (pointer: coarse)');

/**
 * Window width, throttled through rAF so a drag-resize cannot flood React.
 * Used only to pick a card count, never for layout (CSS handles layout).
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  useEffect(() => {
    let frame = 0;
    const onResize = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setWidth(window.innerWidth);
      });
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.removeEventListener('resize', onResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return width;
}

/** State that survives a reload, for view-only preferences. */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* best effort */
      }
    },
    [key],
  );
  return [value, set];
}

/** Run a callback on window resize/orientation, debounced to one frame. */
export function useOnScreenKeyboardHint(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const prevent = (event: Event): void => {
      // Only swallow scrolling when it is the layout itself, never an input.
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable]')) return;
      if (window.scrollY === 0) return;
      event.preventDefault();
    };
    window.addEventListener('touchmove', prevent, { passive: false });
    return () => window.removeEventListener('touchmove', prevent);
  }, [active]);
}

/** Track whether the document is visible, to pause polling when hidden. */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  useEffect(() => {
    const onChange = (): void => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

/** Interval that only runs while `enabled` and the tab is visible. */
export function useThrottledInterval(callback: () => void, delayMs: number, enabled = true): void {
  const latest = useLatest(callback);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') latest.current();
    }, delayMs);
    return () => clearInterval(id);
  }, [delayMs, enabled, latest]);
}
