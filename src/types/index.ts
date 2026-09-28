/**
 * Core domain types.
 *
 * These types are intentionally transport-agnostic (no DOM, no React) so the
 * exact same models can be reused by a future Capacitor / Android TV shell.
 */

export type ContentKind = 'live' | 'movie' | 'series' | 'other';

/** A playable URL plus any provider-mandated request headers. */
export interface StreamSource {
  url: string;
  /** `#EXTVLCOPT:http-user-agent` */
  userAgent?: string;
  /** `#EXTVLCOPT:http-referrer` */
  referrer?: string;
  /** `#EXTVLCOPT:http-origin` */
  origin?: string;
  /**
   * Extra request headers, e.g. a provider-specific token. Entries whose header
   * name the browser forbids (user-agent, referer, origin, host, connection)
   * are ignored at send time rather than failing the request.
   */
  headers?: Record<string, string>;
}

/** Normalised, provider-agnostic playable entry. */
export interface ContentItem {
  /** Stable id: `${playlistId}::${hash(streamUrl + name)}` — survives refreshes. */
  id: string;
  playlistId: string;
  /** Display title (channel / movie / series-episode title). */
  name: string;
  kind: ContentKind;
  /** `group-title` exactly as provided by the provider. */
  group: string;
  logo: string;
  tvgId: string;
  tvgName: string;
  tvgShift: string;
  /** Resolved language code or label, when derivable. */
  language: string;
  /** Resolved ISO country code, when derivable. */
  country: string;
  /** Every other `#EXTINF` attribute, preserved verbatim. */
  attrs: Record<string, string>;
  streams: StreamSource[];
  /** Best-effort release year parsed from the title. */
  year?: number;
  /** Runtime in seconds from `#EXTINF` duration, when present. */
  durationSec?: number;
  /** Epoch ms from an `x-tvg-added`-style attribute, when the provider set one. */
  createdAt?: number;
  /** Lowercased haystack, precomputed at parse time for instant search. */
  search: string;

  /* ---- Series / episode linkage (only when confidently detected) ---- */
  seriesId?: string;
  seriesName?: string;
  season?: number;
  episode?: number;
  seasonName?: string;
  episodeName?: string;
}

/** A detected series: an ordered set of seasons of episodes. */
export interface SeriesGroup {
  id: string;
  playlistId: string;
  name: string;
  logo: string;
  group: string;
  language: string;
  country: string;
  year?: number;
  seasons: SeasonGroup[];
  episodeCount: number;
  /** Most recent `lastPlayedAt` across its episodes. */
  lastPlayedAt?: number;
  /** Highest resume position across episodes, for continue-watching rows. */
  progress?: PlaybackProgress;
}

export interface SeasonGroup {
  season: number;
  name: string;
  episodes: ContentItem[];
}

/** Built once per playlist load; consumed by the Series page and the player. */
export interface SeriesIndex {
  groups: SeriesGroup[];
  byId: Map<string, SeriesGroup>;
  /** Episode item id → its series group, for "next episode" resolution. */
  seriesOfEpisode: Map<string, string>;
}

/** Playlist-level metadata (never the entries themselves). */
export interface PlaylistMeta {
  id: string;
  name: string;
  url: string;
  /** Epoch ms of the last successful fetch/parse. */
  lastUpdated: number | null;
  /** Raw byte-ish size of the source document, for UI + skip logic. */
  sourceLength: number;
  itemCount: number;
  chunkCount: number;
  /**
   * Per-kind totals for the ordinary browse pages.
   *
   * Adult entries are deliberately *not* included in these: they are tallied
   * under `adultCount` instead, so the Movies tab does not advertise content
   * that only becomes visible once a parent has unlocked the Parent section.
   */
  counts: Record<ContentKind, number>;
  /** Entries whose `group-title` marks them as adult. */
  adultCount?: number;
  /** Detected EPG/playlist header info (e.g. `#PLAYLIST:`). */
  headerName?: string;
  status: PlaylistStatus;
  error?: string;
  createdAt: number;
  /**
   * Version of the parse/classification rules used to produce `counts` and the
   * stored items. Bumped whenever `categorize.ts` changes so a cached playlist
   * is re-parsed instead of being served with stale kinds.
   */
  parseVersion?: number;
}

export type PlaylistStatus = 'idle' | 'loading' | 'parsing' | 'ready' | 'error';

export interface PlaybackProgress {
  contentId: string;
  playlistId: string;
  name: string;
  logo: string;
  kind: ContentKind;
  group: string;
  seriesId?: string;
  season?: number;
  episode?: number;
  position: number;
  duration: number;
  /** 0..1, precomputed so rendering never divides. */
  percent: number;
  updatedAt: number;
  /** Total seconds watched, used to drop stale/accidental entries. */
  watchedSec: number;
}

export interface AppSettings {
  /** Preferred starting quality index; -1 === Auto. */
  defaultQuality: number;
  defaultAutoPlay: boolean;
  defaultVolume: number;
  defaultPlaybackRate: number;
  showLanguageFilter: boolean;
  showCountryFilter: boolean;
  /** Hide entries we could not categorise confidently. */
  showOtherCategory: boolean;
  /** Grid density for poster grids. */
  cardDensity: 'comfortable' | 'compact';
  reducedMotion: boolean;
  /**
   * Look up a poster for movies/series whose provider entry has no logo.
   *
   * This sends entry titles to a third-party metadata service (Cinemeta), so it
   * is opt-out rather than opt-in. Turn it off to keep the device fully offline.
   */
  autoFetchPosters: boolean;
  /**
   * Personal OMDb API key, used only to fetch ratings. Empty by default.
   *
   * OMDb requires a key and meters the free tier at 1,000 requests/day, so it
   * cannot be bundled: a key shipped in client JavaScript is a public key that
   * gets shared and exhausted. The user supplies their own from omdbapi.com and
   * it stays on this device, in localStorage alongside the other preferences.
   *
   * While this is empty, ratings come from Cinemeta instead, which needs no key
   * and no quota.
   */
  omdbApiKey: string;
  /**
   * Hide entries whose `group-title` marks them as adult behind a PIN.
   *
   * Off by default: with this enabled those entries leave the ordinary Movies,
   * Series, Live and Search pages entirely, and only appear in the Parent section
   * once the PIN has been entered. See `src/utils/pin.ts` for what this does and
   * does not protect against — it is a household convenience lock, not a
   * security boundary.
   */
  parentControls: boolean;
}

export type ParseProgressStage =
  | 'fetch'
  | 'parse'
  | 'categorize'
  | 'index'
  | 'done';

export interface ParseProgress {
  stage: ParseProgressStage;
  /** 0..1, or null when the total is unknown (streaming parse). */
  ratio: number | null;
  detail: string;
  entries: number;
}

export interface ParseResult {
  playlistId: string;
  items: ContentItem[];
  counts: Record<ContentKind, number>;
  headerName?: string;
  /** Items whose `#EXTINF` was malformed but which still had a URL. */
  skipped: number;
  durationMs: number;
}
