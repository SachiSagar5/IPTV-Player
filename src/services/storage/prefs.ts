/**
 * LocalStorage layer — small preferences ONLY.
 *
 * Hard rule for this codebase: anything that can grow with playlist size
 * (entries, favourites lists, progress maps) belongs in IndexedDB. Values here
 * are a few hundred bytes at most and are read synchronously during boot.
 */
import type { AppSettings } from '@/types';

const PREFIX = 'iptv:';
const KEYS = {
  settings: `${PREFIX}settings`,
  activePlaylist: `${PREFIX}activePlaylist`,
  parentPlaylist: `${PREFIX}parentPlaylist`,
  recentSearches: `${PREFIX}recentSearches`,
  onboardingDone: `${PREFIX}onboardingDone`,
  /** Hash of the parental PIN. Kept out of the settings blob on purpose. */
  adultPin: `${PREFIX}adultPin`,
} as const;

export const DEFAULT_SETTINGS: AppSettings = {
  defaultQuality: -1,
  defaultAutoPlay: true,
  defaultVolume: 1,
  defaultPlaybackRate: 1,
  showLanguageFilter: true,
  showCountryFilter: true,
  showOtherCategory: true,
  cardDensity: 'comfortable',
  reducedMotion: false,
  autoFetchPosters: true,
  omdbApiKey: '',
  parentControls: false,
  corsProxyUrl: '',
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as T;
    if (parsed === null || typeof parsed !== 'object') return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Quota exceeded or private mode — preferences are best-effort. */
  }
}

export function loadSettings(): AppSettings {
  const stored = readJson<Partial<AppSettings>>(KEYS.settings, {});
  // Merge so newly added settings keys pick up their defaults.
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function saveSettings(settings: AppSettings): void {
  writeJson(KEYS.settings, settings);
}

export function loadActivePlaylistId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(KEYS.activePlaylist);
}

export function saveActivePlaylistId(id: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (id === null) localStorage.removeItem(KEYS.activePlaylist);
  else localStorage.setItem(KEYS.activePlaylist, id);
}

/**
 * Which of the Parent-only playlists the section is currently showing.
 *
 * Remembered so the Parent page opens on the same list every time, in the same
 * way `activePlaylist` remembers the ordinary one. Advisory only: the id can
 * point at a playlist that has since been deleted or untagged, and every caller
 * treats that as "fall back to the first available".
 */
export function loadParentPlaylistId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(KEYS.parentPlaylist);
}

export function saveParentPlaylistId(id: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (id === null) localStorage.removeItem(KEYS.parentPlaylist);
  else localStorage.setItem(KEYS.parentPlaylist, id);
}

const MAX_RECENT_SEARCHES = 8;

export function loadRecentSearches(): string[] {
  const value = readJson<string[]>(KEYS.recentSearches, []);
  return Array.isArray(value) ? value.slice(0, MAX_RECENT_SEARCHES) : [];
}

export function pushRecentSearch(term: string): string[] {
  const trimmed = term.trim().slice(0, 64);
  if (trimmed.length < 2) return loadRecentSearches();
  const next = [trimmed, ...loadRecentSearches().filter((t) => t !== trimmed)].slice(
    0,
    MAX_RECENT_SEARCHES,
  );
  writeJson(KEYS.recentSearches, next);
  return next;
}

export function clearRecentSearches(): void {
  writeJson(KEYS.recentSearches, []);
}

export function loadOnboardingDone(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(KEYS.onboardingDone) === '1';
}

export function saveOnboardingDone(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEYS.onboardingDone, '1');
}

/**
 * Stored form of the parental PIN (a hash, never the PIN itself).
 *
 * Deliberately its own key rather than a field on `AppSettings`: the settings
 * blob is merged and rewritten wholesale, and this value should not be a field
 * that ordinary settings handling could clobber or expose. Empty means "never
 * set", in which case `DEFAULT_PIN` applies.
 */
export function loadAdultPinHash(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return localStorage.getItem(KEYS.adultPin) ?? '';
  } catch {
    return '';
  }
}

export function saveAdultPinHash(hash: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (hash) localStorage.setItem(KEYS.adultPin, hash);
    else localStorage.removeItem(KEYS.adultPin);
  } catch {
    /* Storage unavailable; the PIN simply will not survive a reload. */
  }
}
