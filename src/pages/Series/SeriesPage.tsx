/**
 * Series index page.
 *
 * Filters operate on the *derived* series groups, not on episodes, so choosing
 * a group or a language narrows the list of shows. The index is rebuilt on
 * every playlist load and is always far smaller than the playlist itself, so a
 * plain grid (no virtualisation) is correct here.
 */
import { useCallback, useMemo, useRef } from 'react';
import type { SeriesGroup } from '@/types';
import { PageHeader, PageEnd, PageSection } from '@/components/layout/PageHeader';
import { SeriesCard } from '@/components/cards/SeriesCard';
import { EmptyState } from '@/components/common/States';
import { FilterChip, ChipRow, SegmentedControl } from '@/components/common/Form';
import { Button } from '@/components/common/Button';
import { useDpadNavigation } from '@/hooks/useDpadNavigation';
import { useSearchParams } from 'react-router-dom';
import { useAppSelector } from '@/store/appStore';
import { formatCount } from '@/utils/format';
import { QUERY } from '@/utils/routes';

type SeriesSort = 'name' | 'episodes' | 'recent';

const SORT_OPTIONS: ReadonlyArray<{ value: SeriesSort; label: string }> = [
  { value: 'name', label: 'A–Z' },
  { value: 'episodes', label: 'Most episodes' },
  { value: 'recent', label: 'Recently played' },
];

function filterSeries(
  groups: readonly SeriesGroup[],
  query: string,
  group: string,
  language: string,
  sort: SeriesSort,
): SeriesGroup[] {
  const needle = query.trim().toLowerCase();
  const out = groups.filter((s) => {
    if (group && s.group !== group) return false;
    if (language && s.language !== language) return false;
    if (needle && !s.name.toLowerCase().includes(needle)) return false;
    return true;
  });

  switch (sort) {
    case 'name':
      out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      break;
    case 'episodes':
      out.sort((a, b) => b.episodeCount - a.episodeCount);
      break;
    case 'recent':
      out.sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0));
      break;
    default:
      break;
  }
  return out;
}

export default function SeriesPage() {
  const seriesIndex = useAppSelector((s) => s.seriesIndex);
  const [params, setParams] = useSearchParams();
  const rootRef = useRef<HTMLDivElement>(null);

  const query = params.get(QUERY.search) ?? '';
  const group = params.get(QUERY.group) ?? '';
  const language = params.get(QUERY.language) ?? '';
  const sortParam = params.get(QUERY.sort);
  const sort: SeriesSort =
    sortParam === 'episodes' || sortParam === 'recent' ? sortParam : 'name';

  useDpadNavigation(rootRef, { loop: false });

  const groups = seriesIndex.groups;

  // Facets, capped so a pathological provider cannot produce a 4,000-chip bar.
  const facets = useMemo(() => {
    const groupCounts = new Map<string, number>();
    const languageCounts = new Map<string, number>();
    for (const s of groups) {
      if (s.group) groupCounts.set(s.group, (groupCounts.get(s.group) ?? 0) + 1);
      if (s.language) languageCounts.set(s.language, (languageCounts.get(s.language) ?? 0) + 1);
    }
    const top = (counts: Map<string, number>): string[] =>
      Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 40)
        .map(([key]) => key);
    return { groups: top(groupCounts), languages: top(languageCounts) };
  }, [groups]);

  const visible = useMemo(
    () => filterSeries(groups, query, group, language, sort),
    [groups, query, group, language, sort],
  );

  const setParam = useCallback(
    (key: string, value: string) => {
      const draft = new URLSearchParams(params);
      if (value === '') draft.delete(key);
      else draft.set(key, value);
      setParams(draft, { replace: true });
    },
    [params, setParams],
  );

  const clearAll = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);
  const hasActive = Boolean(query || group || language);

  return (
    <div ref={rootRef}>
      <PageHeader
        title="Series"
        subtitle={
          <>
            {formatCount(groups.length)} shows
            {hasActive ? ` · ${formatCount(visible.length)} match your filters` : ''}
          </>
        }
      />

      {groups.length > 0 ? (
        <div className="mb-4 space-y-2.5">
          {facets.groups.length > 0 ? (
            <ChipRow>
              {facets.groups.map((value) => (
                <FilterChip
                  key={value}
                  label={value}
                  active={group === value}
                  onClick={() => setParam(QUERY.group, group === value ? '' : value)}
                />
              ))}
            </ChipRow>
          ) : null}
          {facets.languages.length > 0 ? (
            <ChipRow>
              {facets.languages.map((value) => (
                <FilterChip
                  key={value}
                  label={value}
                  icon="layers"
                  active={language === value}
                  onClick={() => setParam(QUERY.language, language === value ? '' : value)}
                />
              ))}
            </ChipRow>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 px-4 md:px-8">
            <SegmentedControl
              ariaLabel="Sort series"
              size="sm"
              value={sort}
              onChange={(value) => setParam(QUERY.sort, value === 'name' ? '' : value)}
              options={SORT_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
                icon: 'sort' as const,
              }))}
            />
            {hasActive ? (
              <Button variant="ghost" size="sm" icon="close" onClick={clearAll}>
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState
          icon="layers"
          title="No series detected"
          message="Series are inferred from titles that carry season and episode numbers. A playlist of films and channels will not produce any."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="filter"
          title="No series match"
          message="Try a different group, language, or search term."
          action={
            <Button variant="secondary" icon="close" onClick={clearAll}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <PageSection>
          <div
            role="list"
            className="grid grid-cols-3 gap-3 px-4 sm:grid-cols-4 md:grid-cols-6 md:px-8 lg:grid-cols-8 xl:grid-cols-10"
          >
            {visible.map((series, i) => (
              <div key={series.id} role="listitem" className="min-w-0">
                <SeriesCard series={series} index={i} total={visible.length} />
              </div>
            ))}
          </div>
        </PageSection>
      )}

      <PageEnd />
    </div>
  );
}
