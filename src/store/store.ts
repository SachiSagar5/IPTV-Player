/**
 * A ~40 line observable store built on `useSyncExternalStore`.
 *
 * Why not Redux/Zustand? This app needs selector-scoped subscriptions to keep
 * re-renders proportional to visible rows (not to playlist size). The primitive
 * below gives exactly that with zero dependencies, and it is trivially portable
 * to an Android TV shell (no React dependency inside the store itself).
 */
import { useCallback, useRef, useSyncExternalStore } from 'react';

export type Listener = () => void;

export class Store<TState> {
  private state: TState;
  private listeners = new Set<Listener>();
  private notifyScheduled = false;

  constructor(initial: TState) {
    this.state = initial;
  }

  getState = (): TState => this.state;

  /** Replace state. No-ops when the reference is unchanged. */
  setState = (updater: TState | ((prev: TState) => TState)): void => {
    const next =
      typeof updater === 'function' ? (updater as (p: TState) => TState)(this.state) : updater;
    if (Object.is(next, this.state)) return;
    this.state = next;
    this.schedule();
  };

  /**
   * Patch a subset of state. Bails out when every patch value is unchanged,
   * which keeps hot paths (e.g. per-row hover) from waking the tree.
   */
  patch = (partial: Partial<TState> | ((prev: TState) => Partial<TState>)): void => {
    const resolved = typeof partial === 'function' ? partial(this.state) : partial;
    let changed = false;
    for (const key in resolved) {
      if (!Object.is((resolved as Record<string, unknown>)[key], (this.state as Record<string, unknown>)[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...resolved };
    this.schedule();
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Coalesce bursts of writes into one notification per microtask. */
  private schedule(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const l of this.listeners) l();
    });
  }
}

export type StoreApi<TState> = Store<TState>;

/** Subscribe to a derived slice. Results are compared with `Object.is`. */
export function useStoreSelector<TState, TSelected>(
  store: Store<TState>,
  selector: (state: TState) => TSelected,
  isEqual: (a: TSelected, b: TSelected) => boolean = Object.is,
): TSelected {
  const cache = useRef<{ state: TState; selected: TSelected } | null>(null);

  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const cached = cache.current;
    if (cached && Object.is(cached.state, state)) return cached.selected;
    const selected = selector(state);
    if (cached && isEqual(cached.selected, selected)) {
      cache.current = { state, selected: cached.selected };
      return cached.selected;
    }
    cache.current = { state, selected };
    return selected;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, selector, isEqual]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * Shallow comparison for selectors that build a new object/array literal.
 *
 * Deliberately conservative: anything that is not a plain object or array is
 * reported as changed unless it is reference-identical. A `Map` or `Set` has no
 * own enumerable keys, so a naive `Object.keys` walk would call two *different*
 * maps equal and freeze a selector's output forever.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;

  const isPlainish = (v: object): boolean =>
    Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype;
  if (!isPlainish(a) || !isPlainish(b)) return false;

  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

/**
 * Selector factory that memoises a derived object across store updates.
 * Returns a stable reference while the inputs are unchanged.
 */
export function createSelector<TState, TInput, TOutput>(
  input: (s: TState) => TInput,
  output: (i: TInput) => TOutput,
  isEqual: (a: TInput, b: TInput) => boolean = shallowEqual,
): (s: TState) => TOutput {
  let lastInput: TInput | undefined;
  let lastOutput: TOutput | undefined;
  let primed = false;
  return (state: TState): TOutput => {
    const next = input(state);
    if (primed && lastInput !== undefined && isEqual(lastInput, next)) {
      return lastOutput as TOutput;
    }
    lastInput = next;
    lastOutput = output(next);
    primed = true;
    return lastOutput;
  };
}
