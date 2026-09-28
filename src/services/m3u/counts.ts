/**
 * Playlist tallies.
 *
 * Adult entries are counted separately from the four content kinds, and are
 * *subtracted* from the kind totals rather than added to them. That keeps the
 * Movies/Series tabs honest: if a playlist contains nothing but adult entries,
 * the Movies tab correctly does not appear, instead of leading to an empty page
 * that also hints at what the playlist is hiding.
 */
import type { ContentItem, ContentKind } from '@/types';
import { isAdultItem } from './adult';
import { emptyCounts } from '@/services/storage/playlistRepo';

export interface PlaylistTally {
  /** Totals per kind, with adult entries removed. */
  counts: Record<ContentKind, number>;
  /** How many entries were held back for the gated Parent section. */
  adultCount: number;
}

export function tallyItems(items: readonly ContentItem[]): PlaylistTally {
  const counts = emptyCounts();
  let adultCount = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (isAdultItem(item)) {
      adultCount += 1;
      continue;
    }
    counts[item.kind] += 1;
  }
  return { counts, adultCount };
}
