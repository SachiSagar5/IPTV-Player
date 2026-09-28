/**
 * Builds the Series → Season → Episode tree from flat, parse-time-tagged items.
 *
 * Runs once per playlist load (in the worker-adjacent pipeline, before items
 * reach React). Grouping is a single pass over the array with a Map keyed by the
 * precomputed `seriesId`, so 100k entries build in a few milliseconds.
 */
import type { ContentItem, SeriesGroup, SeriesIndex } from '@/types';

export type { SeriesIndex };

function sortEpisodes(a: ContentItem, b: ContentItem): number {
  const sa = a.season ?? 0;
  const sb = b.season ?? 0;
  if (sa !== sb) return sa - sb;
  const ea = a.episode ?? 0;
  const eb = b.episode ?? 0;
  if (ea !== eb) return ea - eb;
  return a.name.localeCompare(b.name);
}

export function buildSeriesIndex(items: ContentItem[]): SeriesIndex {
  const byId = new Map<string, SeriesGroup>();
  const seriesOfEpisode = new Map<string, string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'series' || !item.seriesId) continue;

    let group = byId.get(item.seriesId);
    if (!group) {
      group = {
        id: item.seriesId,
        playlistId: item.playlistId,
        name: item.seriesName ?? item.name,
        logo: item.logo,
        group: item.group,
        language: item.language,
        country: item.country,
        year: item.year,
        seasons: [],
        episodeCount: 0,
      };
      byId.set(item.seriesId, group);
    }
    // Prefer richer artwork / metadata from whichever entry has it.
    if (!group.logo && item.logo) group.logo = item.logo;
    if (!group.language && item.language) group.language = item.language;
    if (!group.year && item.year) group.year = item.year;

    const seasonNumber = item.season ?? 1;
    let season = group.seasons.find((s) => s.season === seasonNumber);
    if (!season) {
      season = { season: seasonNumber, name: `Season ${seasonNumber}`, episodes: [] };
      group.seasons.push(season);
    }
    season.episodes.push(item);
    group.episodeCount += 1;
    seriesOfEpisode.set(item.id, item.seriesId);
  }

  const groups: SeriesGroup[] = [];
  for (const group of byId.values()) {
    group.seasons.sort((a, b) => a.season - b.season);
    for (const season of group.seasons) season.episodes.sort(sortEpisodes);
    // A single lone episode is really a movie mis-tagged by the heuristic.
    // The spec asks us to degrade gracefully rather than fabricate structure.
    if (group.episodeCount < 2) {
      byId.delete(group.id);
      continue;
    }
    groups.push(group);
  }

  groups.sort((a, b) => a.name.localeCompare(b.name));
  return { groups, byId, seriesOfEpisode };
}

/** Resolve the next episode after `current` within its series, or null. */
export function findNextEpisode(
  index: SeriesIndex,
  current: ContentItem,
): ContentItem | null {
  if (!current.seriesId) return null;
  const group = index.byId.get(current.seriesId);
  if (!group) return null;
  for (const season of group.seasons) {
    for (let i = 0; i < season.episodes.length; i++) {
      const episode = season.episodes[i];
      if (episode.id !== current.id) continue;
      // Next within the same season first, then roll into the following season.
      if (i + 1 < season.episodes.length) return season.episodes[i + 1];
      const seasonIdx = group.seasons.indexOf(season);
      const nextSeason = group.seasons[seasonIdx + 1];
      return nextSeason?.episodes[0] ?? null;
    }
  }
  return null;
}

export function findSeriesForItem(
  index: SeriesIndex,
  item: ContentItem,
): SeriesGroup | undefined {
  if (!item.seriesId) return undefined;
  return index.byId.get(item.seriesId);
}

export const EMPTY_SERIES_INDEX: SeriesIndex = {
  groups: [],
  byId: new Map(),
  seriesOfEpisode: new Map(),
};
