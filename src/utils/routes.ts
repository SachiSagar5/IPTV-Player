/**
 * Central route construction.
 *
 * Every `to={...}` in the app goes through this module. That gives us one place
 * to guarantee content ids (which contain `::`) are encoded correctly, and one
 * place to change if the player route ever moves.
 */
import type { ContentItem } from '@/types';
import { hashString } from './id';

export const ROUTES = {
  home: '/',
  live: '/live',
  movies: '/movies',
  series: '/series',
  myList: '/my-list',
  search: '/search',
  playlists: '/playlists',
  settings: '/settings',
  /** Gated behind the parental PIN; see `store/adultGate`. */
  adult: '/parent',
} as const;

const encode = encodeURIComponent;

/** Series ids contain `::`, which must be encoded to survive the URL. */
export function seriesPath(seriesId: string): string {
  return `${ROUTES.series}/${encode(seriesId)}`;
}

export function watchPath(item: ContentItem): string {
  return `/watch/${encode(item.id)}`;
}

export function watchSeriesPath(seriesId: string): string {
  return `/watch/series/${encode(seriesId)}`;
}

export function parseWatchParam(param: string | undefined): string | null {
  if (!param) return null;
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

/** Content ids are `<playlistId>::<hash>`; recover the playlist id. */
export function playlistIdFromContentId(contentId: string): string {
  const index = contentId.indexOf('::');
  return index === -1 ? contentId : contentId.slice(0, index);
}

export function contentIdFromHash(playlistId: string, name: string, url: string): string {
  return `${playlistId}::${hashString(`${name} ${url}`)}`;
}

export const QUERY = {
  search: 'q',
  kind: 'kind',
  group: 'group',
  language: 'lang',
  country: 'country',
  sort: 'sort',
  favorite: 'fav',
} as const;
