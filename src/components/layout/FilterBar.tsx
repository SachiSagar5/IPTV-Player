/**
 * Shared filter bar for the browse pages (Movies / Series / Live / Search).
 *
 * Facets come from `getFacets`, which is capped at the top 60 values by
 * frequency — a provider that ships 4,000 `group-title` values gets a usable
 * bar instead of an unusable one. Anything outside the cap is still reachable
 * through search, which is the honest trade-off.
 */
import { memo } from 'react';
import type { ContentItem } from '@/types';
import { ChipRow, FilterChip, SegmentedControl } from '@/components/common/Form';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { getFacets, useAppSelector } from '@/store/appStore';
import { SORT_OPTIONS } from '@/utils/filters';
import type { FilterState } from '@/utils/filters';

export interface FilterBarProps {
  filters: FilterState;
  hasActive: boolean;
  /** Kinds the facets are computed for; usually a single kind per page. */
  scope?: ContentItem['kind'];
  showSort?: boolean;
  showLanguage?: boolean;
  showCountry?: boolean;
  showFavorites?: boolean;
  onChange: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  onClear: () => void;
}

export const FilterBar = memo(function FilterBar({
  filters,
  hasActive,
  scope,
  showSort = true,
  showLanguage = true,
  showCountry = true,
  showFavorites = true,
  onChange,
  onClear,
}: FilterBarProps) {
  const settings = useAppSelector((s) => s.settings);
  const facets = getFacets(scope);
  const languages = showLanguage && settings.showLanguageFilter ? facets.languages : [];
  const countries = showCountry && settings.showCountryFilter ? facets.countries : [];

  const nothingToShow =
    facets.groups.length === 0 && languages.length === 0 && countries.length === 0;

  if (nothingToShow && !showSort && !showFavorites) return null;

  return (
    <div className="mb-4 space-y-2.5">
      {(facets.groups.length > 0 || languages.length > 0 || countries.length > 0) && (
        <>
          {facets.groups.length > 0 ? (
            <ChipRow>
              {/* "All" is always the first chip, and is the resting state: a
                  group chip is a toggle, so a filtered view used to be
                  unreachable by tapping anything except the active chip. */}
              <FilterChip
                label="All"
                active={filters.group === ''}
                onClick={() => onChange('group', '')}
              />
              {facets.groups.map((group) => (
                <FilterChip
                  key={group}
                  label={group}
                  active={filters.group === group}
                  onClick={() => onChange('group', filters.group === group ? '' : group)}
                />
              ))}
            </ChipRow>
          ) : null}
          {languages.length > 0 ? (
            <ChipRow>
              {languages.map((language) => (
                <FilterChip
                  key={language}
                  label={language}
                  icon="layers"
                  active={filters.language === language}
                  onClick={() =>
                    onChange('language', filters.language === language ? '' : language)
                  }
                />
              ))}
            </ChipRow>
          ) : null}
          {countries.length > 0 ? (
            <ChipRow>
              {countries.map((country) => (
                <FilterChip
                  key={country}
                  label={country}
                  icon="filter"
                  active={filters.country === country}
                  onClick={() => onChange('country', filters.country === country ? '' : country)}
                />
              ))}
            </ChipRow>
          ) : null}
        </>
      )}

      {(showSort || showFavorites || hasActive) && (
        <div className="flex flex-wrap items-center gap-2 px-4 md:px-8">
          {showSort ? (
            <SegmentedControl
              ariaLabel="Sort results"
              size="sm"
              value={filters.sort}
              onChange={(value) => onChange('sort', value)}
              options={SORT_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
                icon: 'sort' as const,
              }))}
            />
          ) : null}

          {showFavorites ? (
            <button
              type="button"
              data-nav
              aria-pressed={filters.favoriteOnly}
              onClick={() => onChange('favoriteOnly', !filters.favoriteOnly)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors ${
                filters.favoriteOnly
                  ? 'border-accent-500 bg-accent-500 text-ink-1000'
                  : 'border-ink-600 bg-ink-850 text-mist-300 hover:border-ink-500'
              }`}
            >
              <Icon name="star" size={12} filled={filters.favoriteOnly} />
              My List
            </button>
          ) : null}

          {hasActive ? (
            <Button variant="ghost" size="sm" icon="close" onClick={onClear}>
              Clear
            </Button>
          ) : null}

          <span className="ml-auto text-xs tabular-nums text-mist-500" aria-live="polite">
            {hasActive ? 'Filtered' : ''}
          </span>
        </div>
      )}
    </div>
  );
});
