/**
 * Filtering + sorting for the browse pages.
 *
 * Pure functions over plain arrays — no store, no React. The pages call these
 * inside a `useMemo` keyed on the filter object, so changing a chip re-filters
 * once and scrolling re-renders nothing.
 */
import type { ContentItem, PlaybackProgress } from '@/types';

export type SortKey = 'title' | 'recent' | 'year' | 'added';

export const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: 'title', label: 'A–Z' },
  { value: 'recent', label: 'Recently added' },
  // Spelled out rather than "Year": this sorts newest first, and the direction
  // is the whole point of the option.
  { value: 'year', label: 'Newest first' },
  { value: 'added', label: 'Recently played' },
];

export interface FilterState {
  group: string;
  language: string;
  country: string;
  favoriteOnly: boolean;
  sort: SortKey;
  /** Free text; the search page adds this. */
  query: string;
}

export const EMPTY_FILTERS: FilterState = {
  group: '',
  language: '',
  country: '',
  favoriteOnly: false,
  sort: 'title',
  query: '',
};

export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.group !== '' ||
    filters.language !== '' ||
    filters.country !== '' ||
    filters.favoriteOnly ||
    filters.query !== ''
  );
}

export interface FilterInput extends FilterState {
  favoriteIds?: ReadonlySet<string>;
  progressById?: ReadonlyMap<string, PlaybackProgress>;
  /** Restrict to a subset of kinds. */
  kinds?: ReadonlySet<ContentItem['kind']>;
}

export function applyFilters(
  items: readonly ContentItem[],
  input: FilterInput,
): ContentItem[] {
  const { group, language, country, favoriteOnly, sort, query } = input;
  const needle = query.trim().toLowerCase();

  const out: ContentItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (input.kinds && !input.kinds.has(item.kind)) continue;
    if (group && item.group !== group) continue;
    if (language && !matchesLanguage(item, language)) continue;
    if (country && !matchesCountry(item, country)) continue;
    if (favoriteOnly && !input.favoriteIds?.has(item.id)) continue;
    if (needle && !item.search.includes(needle)) continue;
    out.push(item);
  }

  sortItems(out, sort, input.progressById);
  return out;
}

function matchesLanguage(item: ContentItem, language: string): boolean {
  if (!item.language) return false;
  return item.language
    .split(/[,/|;]/)
    .map((part) => part.trim().toLowerCase())
    .includes(language.toLowerCase());
}

function matchesCountry(item: ContentItem, country: string): boolean {
  if (!item.country) return false;
  return item.country.slice(0, 2).toUpperCase() === country.toUpperCase();
}

function sortItems(
  items: ContentItem[],
  sort: SortKey,
  progressById?: ReadonlyMap<string, PlaybackProgress>,
): void {
  switch (sort) {
    case 'title':
      items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      return;
    case 'year':
      // Undated entries sort last rather than pretending to be year 0.
      items.sort((a, b) => (b.year ?? -1) - (a.year ?? -1) || a.name.localeCompare(b.name));
      return;
    case 'recent':
      items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      return;
    case 'added':
      items.sort((a, b) => {
        const pa = progressById?.get(a.id)?.updatedAt ?? 0;
        const pb = progressById?.get(b.id)?.updatedAt ?? 0;
        return pb - pa || a.name.localeCompare(b.name);
      });
      return;
    default:
      return;
  }
}

/**
 * Invalidate a playlist when its document changed enough to matter.
 * A byte-identical document is the common case for a provider that is merely
 * reshuffled, and re-parsing those wastes the user's bandwidth and battery.
 */
export function shouldSkipRefresh(
  previous: { sourceLength: number; itemCount: number } | undefined,
  next: { sourceLength: number; itemCount: number },
  tolerance = 0.02,
): boolean {
  if (!previous) return false;
  if (previous.itemCount === next.itemCount) {
    const delta = Math.abs(previous.sourceLength - next.sourceLength);
    return delta <= Math.max(256, previous.sourceLength * tolerance);
  }
  return false;
}
