/**
 * Search.
 *
 * Typing never rescans the playlist: the query is handed to the inverted index
 * that was built in the parse worker, and only the (small) result set is
 * re-rendered. The raw query is debounced at 120ms purely to avoid running the
 * index once per keystroke on a 100k-entry playlist — the index itself is
 * already fast enough to feel instant.
 *
 * Recent searches are persisted to LocalStorage, not IndexedDB: they are a
 * handful of short strings, and synchronous read at boot avoids a flash.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, PageEnd } from '@/components/layout/PageHeader';
import { SimpleGrid } from '@/components/cards/VirtualGrid';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Form';
import { EmptyState } from '@/components/common/States';
import { Icon } from '@/components/common/Icon';
import { useDebouncedValue } from '@/hooks/useMedia';
import { isAdultItem } from '@/services/m3u/adult';
import { useAdultUnlocked } from '@/store/adultGate';
import { useDpadNavigation } from '@/hooks/useDpadNavigation';
import { toggleFavorite, useAppSelector } from '@/store/appStore';
import {
  loadRecentSearches,
  pushRecentSearch,
  clearRecentSearches,
} from '@/services/storage/prefs';
import { formatCount } from '@/utils/format';
import { QUERY } from '@/utils/routes';
import { MAX_RESULTS, type SearchHit } from '@/utils/searchIndex';
import type { ContentItem } from '@/types';

const MAX_RECENT = 8;

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const searchIndex = useAppSelector((s) => s.searchIndex);
  const itemCount = useAppSelector((s) => s.items.length);
  const progressById = useAppSelector((s) => s.progressById);
  const favoriteIds = useAppSelector((s) => s.favoriteIds);

  const initialQuery = params.get(QUERY.search) ?? '';
  const [input, setInput] = useState(initialQuery);
  const [recents, setRecents] = useState<string[]>(() => loadRecentSearches().slice(0, MAX_RECENT));
  const debounced = useDebouncedValue(input, 120);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useDpadNavigation(rootRef, { loop: false });

  // Keep the URL in sync so a search is shareable and survives Back/Forward.
  useEffect(() => {
    const current = params.get(QUERY.search) ?? '';
    if (current === debounced) return;
    const draft = new URLSearchParams(params);
    if (debounced.trim() === '') draft.delete(QUERY.search);
    else draft.set(QUERY.search, debounced);
    setParams(draft, { replace: true });
  }, [debounced, params, setParams]);

  // Adopt the URL when navigation (e.g. Back) changes it out from under us.
  useEffect(() => {
    if (initialQuery !== input) setInput(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  // Search spans the active playlist *and* the reserved Parent playlist, so a
  // title in the gated list is still findable. Whether it is *shown* is the
  // gate's job: search bypasses `useFilters`, so adult hits are filtered out here
  // unless the Parent section has been unlocked this session. Search therefore
  // never becomes a way around the PIN.
  const parentControls = useAppSelector((s) => s.settings.parentControls);
  const parentSearchIndex = useAppSelector((s) => s.parentSearchIndex);
  const unlocked = useAdultUnlocked();
  const hits = useMemo(() => {
    const query = debounced.trim();
    if (query.length < 2) return [];

    const sources = searchIndex ? [searchIndex] : [];
    if (parentSearchIndex) sources.push(parentSearchIndex);

    const found: SearchHit[] = [];
    const seen = new Set<string>();
    for (const index of sources) {
      for (const hit of index.search(query, MAX_RESULTS)) {
        if (seen.has(hit.item.id)) continue;
        seen.add(hit.item.id);
        found.push(hit);
      }
    }
    if (!parentControls || unlocked) return found;
    return found.filter((hit) => !isAdultItem(hit.item));
  }, [debounced, searchIndex, parentSearchIndex, parentControls, unlocked]);

  const items: ContentItem[] = useMemo(() => hits.map((hit) => hit.item), [hits]);

  const commit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length < 2) return;
      setRecents(pushRecentSearch(trimmed).slice(0, MAX_RECENT));
      inputRef.current?.blur();
    },
    [],
  );

  const onToggleFavorite = useCallback((item: ContentItem) => toggleFavorite(item), []);

  const useRecent = useCallback(
    (value: string) => {
      setInput(value);
      commit(value);
    },
    [commit],
  );

  const clear = useCallback(() => {
    setInput('');
    clearRecentSearches();
    setRecents([]);
    inputRef.current?.focus();
  }, []);

  return (
    <div ref={rootRef}>
      <PageHeader title="Search" subtitle="Search titles, groups and channels" />

      <div className="px-4 md:px-8">
        <Input
          ref={inputRef}
          // Remount-free controlled input: value tracks local state only.
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(input);
            if (event.key === 'Escape') setInput('');
          }}
          icon="search"
          placeholder="Search this playlist"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-label="Search this playlist"
          className="h-12 text-base"
          trailing={
            input ? (
              <button
                type="button"
                onClick={clear}
                aria-label="Clear search"
                className="rounded p-1.5 text-mist-500 transition-colors hover:bg-ink-700 hover:text-mist-100"
              >
                <Icon name="close" size={16} />
              </button>
            ) : null
          }
        />
      </div>

      {debounced.trim().length > 0 ? (
        <p className="mt-3 px-4 text-xs text-mist-500 md:px-8" aria-live="polite">
          {searchIndex
            ? hits.length === 0
              ? `No matches for “${debounced.trim()}”`
              : `${formatCount(hits.length)}${hits.length >= MAX_RESULTS ? '+' : ''} result${hits.length === 1 ? '' : 's'} for “${debounced.trim()}”`
            : 'Preparing the search index…'}
        </p>
      ) : recents.length > 0 ? (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between px-4 md:px-8">
            <h2 className="text-xs font-semibold tracking-[0.12em] text-mist-500 uppercase">
              Recent searches
            </h2>
            <Button variant="ghost" size="sm" icon="trash" onClick={clear}>
              Clear
            </Button>
          </div>
          <ul className="flex flex-wrap gap-2 px-4 md:px-8">
            {recents.map((value) => (
              <li key={value}>
                <button
                  type="button"
                  data-nav
                  onClick={() => useRecent(value)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-600 bg-ink-850 px-3 text-xs text-mist-200 transition-colors hover:border-ink-500 hover:bg-ink-800"
                >
                  <Icon name="clock" size={12} className="text-mist-500" />
                  <span className="max-w-[18ch] truncate">{value}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6">
        {debounced.trim().length === 0 ? (
          <EmptyState
            icon="search"
            title="Search across everything"
            message={`Type at least two characters. Results come from a prebuilt index of all ${formatCount(itemCount)} entries, so they appear instantly.`}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon="search"
            title="Nothing matched"
            message="Try fewer words, or search from the Movies, Series or Live TV pages where you can also filter by group."
          />
        ) : (
          <SimpleGrid
            items={items}
            variant="poster"
            progressById={progressById}
            favoriteIds={favoriteIds}
            onToggleFavorite={onToggleFavorite}
          />
        )}
      </div>

      <PageEnd />
    </div>
  );
}

export { MAX_RECENT };
