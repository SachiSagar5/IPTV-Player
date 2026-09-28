/**
 * Adult (18+) content detection, used to keep such entries out of the normal
 * browse pages until a parent has unlocked the section.
 *
 * Detection is driven by the provider's own `group-title`, because that is the
 * only place a playlist states its category explicitly. Guessing from the title
 * would misfire on ordinary shows — "Sex Education", "The Naked Gun", "Babes"
 * are all clean titles that appear in real provider playlists — so names are
 * deliberately not consulted.
 *
 * The consequence is worth knowing: a playlist that mixes adult entries into a
 * shared group such as "Movies" will not be detected here. This finds the
 * common case (dedicated `XXX` / `Adult` groups), not every possible layout.
 * Add markers below as new provider naming shows up.
 *
 * A provider that labels nothing at all cannot be caught by any regex, so the
 * playlist-level half of this file is not the only route in: a parent can tag a
 * playlist `parentOnly` by hand and it is gated regardless. Detection and the
 * manual tag are unioned in `pickParentPlaylistIds` rather than one overriding
 * the other, because each covers the other's blind spot.
 */
import type { ContentItem } from '@/types';

/**
 * Word-bounded markers so `XXX` matches as a whole word and cannot be triggered
 * by an unrelated string. `\b18\+` is deliberately absent: `+` is not a word
 * character, so `\b18\+\b` can never match — the numeric form is handled
 * separately below.
 */
const ADULT_GROUP = /\b(xxx|xxl|adult|adults|porno|porn|pornhub|porntree|xvideos|xhamster|redtube|youporn|onlyfans|hentai|erotic|erotica|nsfw|playboy|brazzers|naughty)\b/i;

/** `18+`, `18 +`, `18plus`, `18 plus`, `21plus` — digit and separator both optional. */
const ADULT_NUMERIC = /(^|[^\d])(1[89]|2[01])\s*\+|(?:1[89]|2[01])\s*plus/i;

/** True when a provider's `group-title` marks the group as adult. */
export function isAdultGroup(group: string): boolean {
  if (!group) return false;
  return ADULT_GROUP.test(group) || ADULT_NUMERIC.test(group);
}

/** True when this entry belongs in the gated 18+ section. */
export function isAdultItem(item: Pick<ContentItem, 'group'>): boolean {
  return isAdultGroup(item.group);
}

/** Filters a list down to the adult entries, preserving order. */
export function adultOnly<T extends Pick<ContentItem, 'group'>>(items: readonly T[]): T[] {
  return items.filter(isAdultItem);
}

/* ------------------------------------------------------------------ *
 * Playlist-level detection
 * ------------------------------------------------------------------ */

/**
 * Fraction of a playlist's entries that must be adult before the whole playlist
 * is treated as the Parent list.
 *
 * This is deliberately a majority rather than "any adult entry". Real general
 * entertainment playlists routinely carry a handful of entries in an `XXX`
 * group alongside thousands of ordinary ones; reserving the entire playlist for
 * the Parent page over a single stray entry would take the user's whole library
 * out of normal browsing. A majority means the playlist *is* an adult playlist,
 * which is the case this feature is for.
 *
 * Individual adult entries in a mixed playlist are still handled by the
 * per-entry gate above — they are simply withheld from the ordinary pages rather
 * than taking the whole playlist with them.
 */
export const PARENT_PLAYLIST_ADULT_RATIO = 0.5;

/** The minimum shape `isParentPlaylist` needs, so callers can pass meta or items. */
export interface ParentPlaylistCandidate {
  adultCount?: number;
  itemCount: number;
}

/** True when this playlist is predominantly adult, so it is the Parent list. */
export function isParentPlaylist(candidate: ParentPlaylistCandidate): boolean {
  const adults = candidate.adultCount ?? 0;
  if (adults <= 0 || candidate.itemCount <= 0) return false;
  return adults >= candidate.itemCount * PARENT_PLAYLIST_ADULT_RATIO;
}

/** The adult share of a playlist, 0..1. Used to rank candidates and to show it. */
export function adultRatio(candidate: ParentPlaylistCandidate): number {
  if (candidate.itemCount <= 0) return 0;
  return (candidate.adultCount ?? 0) / candidate.itemCount;
}

/** The shape `pickParentPlaylistIds` needs, so callers can pass `PlaylistMeta` directly. */
export interface ParentPlaylistCandidateWithId extends ParentPlaylistCandidate {
  id: string;
  /**
   * The parent's own "keep this one gated" tag. Optional and distinct from
   * detection: it is the only route in for a provider that labels nothing.
   */
  parentOnly?: boolean;
}

/**
 * Every playlist that belongs on the Parent page: the ones tagged by hand, plus
 * the ones that tripped the majority-adult rule.
 *
 * Both routes are unioned rather than one overriding the other, because they
 * fail in opposite directions. Detection catches the labelled playlist nobody
 * tagged; the manual tag catches the unlabelled one detection can never see
 * (`adultCount` is 0 for a source with no `group-title` at all).
 *
 * Order is manual tags first, then detected lists by descending adult share, so
 * a deliberate choice wins the default slot on a fresh install.
 */
export function pickParentPlaylistIds<T extends ParentPlaylistCandidateWithId>(
  metas: readonly T[],
): string[] {
  const tagged: string[] = [];
  const detected: { id: string; ratio: number; adults: number }[] = [];

  for (const meta of metas) {
    if (meta.parentOnly) {
      tagged.push(meta.id);
      continue;
    }
    if (!isParentPlaylist(meta)) continue;
    detected.push({
      id: meta.id,
      ratio: adultRatio(meta),
      adults: meta.adultCount ?? 0,
    });
  }

  // Ties on share go to the larger playlist: of two equally adult lists, the
  // bigger one is the one the parent meant.
  detected.sort((a, b) => b.ratio - a.ratio || b.adults - a.adults);
  return [...tagged, ...detected.map((entry) => entry.id)];
}
