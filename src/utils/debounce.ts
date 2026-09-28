/** Trailing-edge debounce with cancel + flush, used by search and resize work. */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
  flush(): void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const debounced = (...args: A): void => {
    pending = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const call = pending;
      pending = null;
      if (call) fn(...call);
    }, waitMs);
  };

  debounced.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  debounced.flush = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const call = pending;
    pending = null;
    if (call) fn(...call);
  };

  return debounced;
}

/** Yield to the event loop so long synchronous work can report progress. */
export function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
