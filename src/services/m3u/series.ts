/**
 * Series / season / episode extraction.
 *
 * The contract from the spec is important here: when season/episode information
 * cannot be *reliably* detected, the entry must degrade to plain VOD rather than
 * being slotted into a fabricated season structure. Every pattern below must
 * extract BOTH a season and an episode number to qualify, or the caller is told
 * "no series info" and keeps the item as a movie/other.
 */

export interface SeriesInfo {
  seriesName: string;
  season?: number;
  episode?: number;
  seasonName?: string;
  episodeName?: string;
}

interface Match {
  seriesName: string;
  season: number;
  episode: number;
  index: number;
  length: number;
}

/** `S01E02`, `S1 E2`, `s01.e02`, `1x02` */
const PATTERNS: RegExp[] = [
  // S01E02 / s01.e02 / S1E2
  /\b[Ss](\d{1,3})[\s._-]*[Ee](\d{1,3})\b/,
  // 1x02
  /\b(\d{1,2})x(\d{2,3})\b/,
  // 102 -> S1E02 is ambiguous; only used after the two above fail.
  // "Season 1 Episode 2" / "Season 1, Episode 2"
  /\b[Ss]eason[\s._-]*(\d{1,3})[\s._,:-]+[Ee]pisode[\s._-]*(\d{1,3})\b/,
  // "S1 - E5" / "S1:E5"
  /\b[Ss](\d{1,3})[\s._:-]+[Ee](\d{1,3})\b/,
  // "Season 1 Ep 5"
  /\b[Ss]eason[\s._-]*(\d{1,3})[\s._,:-]+[Ee]p?[\s._-]*(\d{1,3})\b/,
];

function findMatch(name: string): Match | null {
  for (const pattern of PATTERNS) {
    const m = pattern.exec(name);
    if (!m) continue;
    const season = Number.parseInt(m[1], 10);
    const episode = Number.parseInt(m[2], 10);
    if (!Number.isFinite(season) || !Number.isFinite(episode)) continue;
    // Reject implausible values so "S1 E9999" style noise does not create
    // bogus season structures.
    if (season < 0 || season > 99 || episode < 0 || episode > 999) continue;
    return {
      seriesName: name.slice(0, m.index).trim(),
      season,
      episode,
      index: m.index,
      length: m[0].length,
    };
  }
  return null;
}

const TRAILING_JUNK = /[\s._\-–—|:·,]+$/;
const LEADING_JUNK = /^[\s._\-–—|:·,/\\]+/;

function tidySeriesName(raw: string): string {
  return raw
    .replace(LEADING_JUNK, '')
    .replace(TRAILING_JUNK, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Extract series metadata from a title.
 * Returns `null` when no confident season+episode pair is present.
 */
export function extractSeriesInfo(name: string): SeriesInfo | null {
  const match = findMatch(name);
  if (!match) return null;

  const seriesName = tidySeriesName(match.seriesName);
  // A bare "S1E1" with no title carries no series identity — treat as VOD.
  if (seriesName.length < 2) return null;

  const remainder = tidySeriesName(name.slice(match.index + match.length));
  // Some providers name the episode after the code: "Show S1E1 – Pilot".
  const episodeName = remainder || undefined;

  return {
    seriesName,
    season: match.season,
    episode: match.episode,
    seasonName: `Season ${match.season}`,
    episodeName,
  };
}

/** Cheap pre-check used to avoid running the full matcher on every entry. */
export function looksLikeSeriesTitle(name: string): boolean {
  return /[Ss]\d{1,3}\s*[Ee]\d{1,3}|\d{1,2}x\d{2,3}|[Ss]eason\s*\d/i.test(name);
}

/** Human-facing episode label: "S1 · E2". */
export function episodeLabel(season?: number, episode?: number): string {
  if (season == null || episode == null) return '';
  return `S${season} · E${episode}`;
}
