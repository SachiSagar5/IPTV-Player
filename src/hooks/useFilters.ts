/**
 * URL-synced browse filters.
 *
 * Filters live in the query string, not component state, for three reasons:
 * a filtered view is shareable and survives a refresh; Back returns to the
 * previous filter rather than the previous site; and a TV remote can navigate
 * to a filtered view directly.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ContentItem, PlaybackProgress } from '@/types';
import { applyFilters, EMPTY_FILTERS } from '@/utils/filters';
import type { FilterState, SortKey } from '@/utils/filters';
import { QUERY } from '@/utils/routes';
import { isAdultItem } from '@/services/m3u/adult';
import { useAppSelector } from '@/store/appStore';

const VALID_SORTS: ReadonlySet<string> = new Set(['title', 'recent', 'year', 'added']);

export interface UseFiltersOptions {
  /** Restrict the candidate set (e.g. only movies on the Movies page). */
  kinds?: ReadonlySet<ContentItem['kind']>;
  /** Search page only: also write the query into `?q=`. */
  includeQuery?: boolean;
  /**
   * Sort used when the URL does not name one. Movies default to newest-first;
   * everything else keeps A–Z. Live channels have no meaningful year, so a
   * year sort there would push every entry to the bottom.
   */
  defaultSort?: SortKey;
  /** Start from these items instead of the whole active playlist. */
  source?: readonly ContentItem[];
  /**
   * Set for a surface that is *meant* to show adult entries (the Parent page).
   * Left false everywhere else, which is what withholds them.
   */
  includeAdult?: boolean;
}

export interface UseFiltersResult {
  filters: FilterState;
  setFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  toggleGroup: (group: string) => void;
  clearAll: () => void;
  hasActive: boolean;
  result: ContentItem[];
  progressById: ReadonlyMap<string, PlaybackProgress>;
  favoriteIds: ReadonlySet<string>;
}

export function useFilters(options: UseFiltersOptions = {}): UseFiltersResult {
  const {
    kinds,
    includeQuery = false,
    defaultSort = EMPTY_FILTERS.sort,
    source,
    includeAdult = false,
  } = options;
  const parentControls = useAppSelector((s) => s.settings.parentControls);
  const [params, setParams] = useSearchParams();
  const items = useAppSelector((s) => s.items);
  const progressById = useAppSelector((s) => s.progressById);
  const favoriteIds = useAppSelector((s) => s.favoriteIds);

  const filters = useMemo<FilterState>(() => {
    const sort = params.get(QUERY.sort);
    return {
      group: params.get(QUERY.group) ?? EMPTY_FILTERS.group,
      language: params.get(QUERY.language) ?? EMPTY_FILTERS.language,
      country: params.get(QUERY.country) ?? EMPTY_FILTERS.country,
      favoriteOnly: params.get(QUERY.favorite) === '1',
      sort: (sort && VALID_SORTS.has(sort) ? sort : defaultSort) as SortKey,
      query: includeQuery ? (params.get(QUERY.search) ?? '') : '',
    };
  }, [params, includeQuery, defaultSort]);

  const write = useCallback(
    (next: FilterState) => {
      const draft = new URLSearchParams(params);
      const setOrDelete = (key: string, value: string, empty: boolean): void => {
        if (empty) draft.delete(key);
        else draft.set(key, value);
      };
      setOrDelete(QUERY.group, next.group, next.group === '');
      setOrDelete(QUERY.language, next.language, next.language === '');
      setOrDelete(QUERY.country, next.country, next.country === '');
      setOrDelete(QUERY.favorite, '1', !next.favoriteOnly);
      // Compared against *this surface's* default, not the global one. Comparing
      // against `EMPTY_FILTERS.sort` would make a non-global default (Movies
      // starts at 'year') unselectable: picking A–Z would strip the param and
      // immediately fall back to 'year'.
      if (next.sort !== defaultSort) draft.set(QUERY.sort, next.sort);
      else draft.delete(QUERY.sort);
      if (includeQuery) setOrDelete(QUERY.search, next.query, next.query.trim() === '');
      setParams(draft, { replace: true });
    },
    [params, setParams, includeQuery, defaultSort],
  );

  const setFilter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      write({ ...filters, [key]: value });
    },
    [write, filters],
  );

  const toggleGroup = useCallback(
    (group: string) => {
      write({ ...filters, group: filters.group === group ? '' : group });
    },
    [write, filters],
  );

  const clearAll = useCallback(() => {
    setParams(new URLSearchParams(), { replace: true });
  }, [setParams]);

  const hasActive =
    filters.group !== '' ||
    filters.language !== '' ||
    filters.country !== '' ||
    filters.favoriteOnly ||
    filters.query.trim() !== '';

  // Withhold adult entries unless this surface opted into them. Done here, at
  // the single point every catalog page filters through, so a new page cannot
  // accidentally leak them by forgetting to filter.
  const candidates = useMemo(() => {
    const base = source ?? items;
    if (includeAdult || !parentControls) return base;
    return base.filter((item) => !isAdultItem(item));
  }, [source, items, includeAdult, parentControls]);

  const result = useMemo(
    () => applyFilters(candidates, { ...filters, favoriteIds, progressById, kinds }),
    [candidates, filters, favoriteIds, progressById, kinds],
  );

  return { filters, setFilter, toggleGroup, clearAll, hasActive, result, progressById, favoriteIds };
}
