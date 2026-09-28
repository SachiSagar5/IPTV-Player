/**
 * M3U / M3U8 playlist tokenizer and normaliser.
 *
 * Pure functions only — no DOM, no React, no network. That makes this module
 * importable from the Web Worker *and* from the main-thread fallback, and
 * unit-testable in isolation.
 *
 * Performance notes
 *  - Single forward pass over the raw text; no regex over the whole document.
 *  - Attribute parsing is a small hand-rolled scanner (regex per line was the
 *    single biggest cost on 100k-line playlists in profiling).
 *  - The search haystack is lowercased once, here, at build time, so search
 *    never re-normalises during keystrokes.
 */
import type { ContentItem, ContentKind, StreamSource } from '@/types';
import { contentId } from '@/utils/id';
import { detectKind } from './categorize';
import { buildSearchBlob } from './search';
import { extractSeriesInfo } from './series';

export interface ParseOptions {
  playlistId: string;
  /** Called every `progressEvery` lines. Runs in the worker; must be cheap. */
  onProgress?: (entries: number, totalLines: number) => void;
  progressEvery?: number;
}

/**
 * Attribute prefixes with a known destination: `tvg-*` is promoted to a
 * first-class field on the item, `http-*` becomes a request header, `x-*` is
 * provider-private noise. Anything else is preserved verbatim.
 */
const KNOWN_PREFIXES = ['tvg-', 'http-', 'x-'] as const;

/** Scan `key="value"` pairs starting at `i`. Returns the index after the run. */
function scanAttributes(
  text: string,
  start: number,
  end: number,
  out: Record<string, string>,
): number {
  let i = start;
  while (i < end) {
    while (i < end && text.charCodeAt(i) <= 32) i++;
    const eq = text.indexOf('=', i);
    if (eq === -1 || eq > end) break;

    let keyEnd = eq;
    while (keyEnd > i && text.charCodeAt(keyEnd - 1) <= 32) keyEnd--;
    const key = text.slice(i, keyEnd).toLowerCase();

    let j = eq + 1;
    while (j < end && text.charCodeAt(j) <= 32) j++;

    let value = '';
    const quote = text.charCodeAt(j);
    if (quote === 34 /* " */ || quote === 39 /* ' */) {
      const closing = text.indexOf(quote === 34 ? '"' : "'", j + 1);
      if (closing === -1 || closing > end) {
        value = text.slice(j + 1, end);
        j = end;
      } else {
        value = text.slice(j + 1, closing);
        j = closing + 1;
      }
    } else {
      let valueEnd = j;
      while (valueEnd < end && text.charCodeAt(valueEnd) > 32) valueEnd++;
      value = text.slice(j, valueEnd);
      j = valueEnd;
    }

    if (key) out[key] = value;
    i = j;
  }
  return i;
}

function buildStreams(url: string, extraLines: string[], attrs: Record<string, string>): StreamSource[] {
  if (/^rtsp:/i.test(url)) {
    // RTSP cannot play in a browser — drop it rather than surface a
    // confusing player error later.
    return [];
  }

  const stream: StreamSource = { url };

  // #EXTVLCOPT:http-user-agent / http-referrer / http-origin
  // Providers use these to gate streams behind referer checks. A browser
  // silently drops the first and third as forbidden headers; the values are kept
  // anyway so the player can report why a stream will not play.
  const extraHeaders: Record<string, string> = {};
  for (const line of extraLines) {
    if (!line.startsWith('#EXTVLCOPT:')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice('#EXTVLCOPT:'.length, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    if (!value) continue;
    if (key === 'http-user-agent') stream.userAgent = value;
    else if (key === 'http-referrer') stream.referrer = value;
    else if (key === 'http-origin') stream.origin = value;
    // `#EXTVLCOPT:http-header=Referer: https://…` — the generic form.
    else if (key === 'http-header' || key === 'http-headers') {
      const colon = value.indexOf(':');
      if (colon > 0) {
        const name = value.slice(0, colon).trim();
        const headerValue = value.slice(colon + 1).trim();
        if (name && headerValue) extraHeaders[name] = headerValue;
      }
    }
  }

  // Headers declared as plain EXTINF attributes (`http-token="…"`).
  for (const [name, value] of Object.entries(attrs)) {
    if (name.startsWith('http-') && value) extraHeaders[name] = value;
  }

  if (Object.keys(extraHeaders).length > 0) stream.headers = extraHeaders;

  // Some providers list alternates as extra bare lines after the EXTINF block.
  const alternates: StreamSource[] = [];
  for (const line of extraLines) {
    if (!line.startsWith('#') && line !== url && /^https?:/i.test(line)) {
      alternates.push({ ...stream, url: line });
    }
  }
  return alternates.length > 0 ? alternates : [stream];
}

/** `#EXTINF:-1 tvg-id="x" group-title="Y",Display Name` */
function parseExtInf(line: string): {
  duration: number;
  attrs: Record<string, string>;
  name: string;
} {
  const durationStart = 5; // after "#EXTINF:"
  let i = durationStart;
  const len = line.length;
  while (i < len && line.charCodeAt(i) > 32 && line.charCodeAt(i) !== 44) i++;
  const duration = Number.parseInt(line.slice(durationStart, i), 10);

  const attrs: Record<string, string> = {};
  scanAttributes(line, i, len, attrs);

  // Display name is everything after the last comma on the line.
  const comma = line.lastIndexOf(',');
  const name = (comma === -1 ? line.slice(i) : line.slice(comma + 1)).trim();
  return { duration: Number.isFinite(duration) ? duration : -1, attrs, name };
}

/**
 * Preserve provider-specific attributes verbatim so classification can use them
 * (`kodi-type`, etc.). Attributes under a known prefix are dropped: `tvg-*` is
 * promoted to a first-class field, `http-*` becomes a request header, and
 * `x-*` is almost always a provider's private debug key.
 */
function collectExtraAttributes(attrs: Record<string, string>): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const key in attrs) {
    if (KNOWN_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    extra[key] = attrs[key];
  }
  return extra;
}

/**
 * Parse a full M3U document into normalised content items.
 *
 * Malformed entries are skipped rather than fatal: a provider with one bad line
 * must not cost the user their whole playlist.
 */
export function parseM3U(text: string, options: ParseOptions): {
  items: ContentItem[];
  headerName?: string;
  skipped: number;
} {
  const { playlistId, onProgress, progressEvery = 4000 } = options;
  const items: ContentItem[] = [];
  let skipped = 0;
  let headerName: string | undefined;

  const totalLength = text.length;
  let pos = 0;

  // Pending state: attributes/description from the #EXTINF line.
  let pending: {
    duration: number;
    attrs: Record<string, string>;
    name: string;
    extraLines: string[];
  } | null = null;
  let pendingCount = 0;

  while (pos < totalLength) {
    let lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = totalLength;
    let end = lineEnd;
    if (end > pos && text.charCodeAt(end - 1) === 13) end--;
    const line = text.slice(pos, end);
    pos = lineEnd + 1;
    if (line.length === 0) continue;

    const first = line.charCodeAt(0);

    if (first === 35 /* # */) {
      if (line.startsWith('#EXTM3U')) {
        const nameMatch = /#PLAYLIST:([^\r\n]*)/i.exec(line);
        if (nameMatch) headerName = nameMatch[1].trim();
        continue;
      }
      if (line.startsWith('#EXTINF:')) {
        const parsed = parseExtInf(line);
        pending = { ...parsed, extraLines: [] };
        continue;
      }
      if (pending) pending.extraLines.push(line);
      continue;
    }

    if (!pending) {
      // A bare URL with no #EXTINF. Providers do this; keep it as "other".
      const trimmed = line.trim();
      if (/^(https?|rtsp|rtmp|udp|rtp):/i.test(trimmed)) {
        skipped += 1;
        pending = null;
      }
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const streams = buildStreams(trimmed, pending.extraLines, pending.attrs);
    if (streams.length === 0) {
      skipped += 1;
      pending = null;
      continue;
    }

    const { attrs, name, duration } = pending;
    const group = attrs['group-title'] ?? '';
    const extGrp = pending.extraLines.find((l) => l.startsWith('#EXTGRP:'));
    const finalGroup = group || (extGrp ? extGrp.slice(8).trim() : '');

    const logo = attrs['tvg-logo'] || attrs['logo'] || '';
    const tvgId = attrs['tvg-id'] || '';
    const tvgName = attrs['tvg-name'] || '';
    const countryAttr =
      attrs['tvg-country'] || attrs['country'] || attrs['x-country'] || '';
    const languageAttr =
      attrs['tvg-language'] || attrs['language'] || attrs['x-language'] || '';

    const baseName = name || tvgName || tvgId || 'Untitled';
    const kind: ContentKind = detectKind({
      name: baseName,
      group: finalGroup,
      tvgId,
      attrs,
      hasVodMarker: hasVodMarker(pending.extraLines, attrs),
      // The primary stream URL is a stronger content-type signal than any
      // `group-title` a provider chose to write.
      streamUrl: streams[0].url,
    });

    const series = kind === 'series' || kind === 'movie' ? extractSeriesInfo(baseName) : null;

    const item: ContentItem = {
      id: contentId(playlistId, baseName, streams[0].url),
      playlistId,
      name: baseName,
      kind,
      group: finalGroup,
      logo,
      tvgId,
      tvgName,
      tvgShift: attrs['tvg-shift'] ?? attrs['catchup-days'] ?? '',
      language: languageAttr,
      country: countryAttr,
      attrs: collectExtraAttributes(attrs),
      streams,
      search: buildSearchBlob(baseName, finalGroup, tvgName, tvgId, languageAttr, countryAttr),
    };

    if (duration > 0) item.durationSec = duration;
    const year = extractYear(baseName);
    if (year) item.year = year;

    if (series && series.season != null && series.episode != null) {
      item.seriesId = `${playlistId}::series::${series.seriesName.toLowerCase()}`;
      item.seriesName = series.seriesName;
      item.season = series.season;
      item.episode = series.episode;
      item.episodeName = series.episodeName ?? baseName;
    }

    items.push(item);
    pending = null;
    pendingCount += 1;

    if (onProgress && pendingCount % progressEvery === 0) onProgress(pendingCount, 0);
  }

  if (onProgress) onProgress(items.length, 0);
  return { items, headerName, skipped };
}

const VOD_KODI_TYPES = /^(movie|episode|series)$/i;

function hasVodMarker(extraLines: string[], attrs: Record<string, string>): boolean {
  const kodiType = attrs['kodi-type'];
  if (kodiType && VOD_KODI_TYPES.test(kodiType)) return true;
  if (attrs['vod'] === '1' || attrs['is-vod'] === '1') return true;
  for (const line of extraLines) {
    // #KODIPROP:inputstream.adaptive.manifest_type=mpd  (DASH, not live)
    if (line.startsWith('#KODIPROP:inputstream.adaptive.manifest_type=mpd')) return true;
    if (line.startsWith('#EXTVOD') || line.startsWith('#EXTMOVIE')) return true;
  }
  return false;
}

const YEAR_RE = /[\s(.\-[/](19\d{2}|20\d{2})[\s).\-/]/;

function extractYear(name: string): number | undefined {
  const m = YEAR_RE.exec(name);
  if (!m) return undefined;
  const year = Number.parseInt(m[1], 10);
  if (year < 1950 || year > new Date().getFullYear() + 2) return undefined;
  return year;
}
