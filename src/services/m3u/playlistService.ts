/**
 * Playlist pipeline: fetch -> parse (worker) -> categorise -> index -> persist.
 *
 * `runParse` / `loadPlaylistFromUrl` are plain functions with no React import.
 * The store calls them; components never do. That keeps parsing testable and
 * means a future Android shell can drive the identical pipeline.
 */
import { parseM3U } from './parser';
import { fetchPlaylistText, PlaylistFetchError, validatePlaylistUrl } from './fetcher';
import { buildSeriesIndex } from './seriesIndex';
import { buildCompactSearchIndex, SearchIndex } from '@/utils/searchIndex';
import { shouldSkipRefresh } from '@/utils/filters';
import type { CompactSearchIndex } from '@/utils/searchIndex';
import type {
  ContentItem,
  ContentKind,
  ParseProgress,
  ParseResult,
  PlaylistMeta,
} from '@/types';
import { playlistsRepo } from '@/services/storage/playlistRepo';
import { tallyItems } from './counts';
import type { ParseRequestMessage, WorkerOutMessage } from '@/workers/m3uParser.worker';

let worker: Worker | null = null;
let workerFailed = false;
let requestSeq = 0;

function getWorker(): Worker | null {
  if (workerFailed) return null;
  if (worker) return worker;
  if (typeof Worker === 'undefined') {
    workerFailed = true;
    return null;
  }
  try {
    worker = new Worker(new URL('../../workers/m3uParser.worker.ts', import.meta.url), {
      type: 'module',
      name: 'm3u-parser',
    });
    worker.addEventListener('error', () => {
      // A worker that fails to boot (strict CSP, blocked blob) must not break
      // the app: fall back to chunked main-thread parsing from now on.
      workerFailed = true;
      worker?.terminate();
      worker = null;
    });
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

/** Yield to the browser so long work can paint progress and stay cancellable. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Bump whenever parsing, classification or id generation changes meaning.
 *
 * Stored on the playlist meta. A mismatch invalidates every "the playlist did
 * not change, reuse the cached parse" shortcut, which is what makes a fix to
 * `categorize.ts` actually reach playlists that were already downloaded.
 */
export const PARSE_VERSION = 3;

interface ParsedOutput {
  items: ContentItem[];
  counts: Record<ContentKind, number>;
  adultCount: number;
  headerName?: string;
  skipped: number;
  compactIndex: CompactSearchIndex;
}

export interface ParseOutcome extends ParseResult {
  meta: PlaylistMeta;
  seriesCount: number;
  sourceLength: number;
  compactIndex: CompactSearchIndex;
}

export interface ParseInput {
  playlistId: string;
  name: string;
  url: string;
  text: string;
  sourceLength: number;
  createdAt: number;
  lastUpdated: number | null;
  /**
   * Carried across a refresh so re-parsing cannot quietly drop a parent's own
   * tag. Only ever the value already stored on the playlist, which is why
   * untagging sticks: the stored flag is false before the next parse runs.
   */
  parentOnly?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: ParseProgress) => void;
}

export async function runParse(input: ParseInput): Promise<ParseOutcome> {
  const { playlistId, text, onProgress } = input;
  const startedAt = performance.now();

  onProgress?.({ stage: 'parse', ratio: null, detail: 'Parsing entries…', entries: 0 });

  const parsed = await parseInWorkerOrChunks(playlistId, text, onProgress, input.signal);

  if (input.signal?.aborted) {
    throw new PlaylistFetchError('aborted', 'Request cancelled.');
  }

  onProgress?.({
    stage: 'index',
    ratio: null,
    detail: 'Grouping series…',
    entries: parsed.items.length,
  });

  const seriesIndex = buildSeriesIndex(parsed.items);

  onProgress?.({
    stage: 'done',
    ratio: 1,
    detail: `${parsed.items.length.toLocaleString()} items ready`,
    entries: parsed.items.length,
  });

  const meta: PlaylistMeta = {
    id: playlistId,
    name: input.name,
    url: input.url,
    lastUpdated: input.lastUpdated,
    sourceLength: input.sourceLength,
    itemCount: parsed.items.length,
    chunkCount: 0,
    counts: parsed.counts,
    adultCount: parsed.adultCount,
    headerName: parsed.headerName,
    status: 'ready',
    createdAt: input.createdAt,
    parseVersion: PARSE_VERSION,
    // A tag is a statement about the *playlist*, not about its contents, so it
    // has to outlive a re-parse. Spread conditionally to keep the record free of
    // a meaningless `parentOnly: false`.
    ...(input.parentOnly ? { parentOnly: true } : {}),
  };

  return {
    playlistId,
    items: parsed.items,
    counts: parsed.counts,
    headerName: parsed.headerName,
    skipped: parsed.skipped,
    durationMs: performance.now() - startedAt,
    meta,
    seriesCount: seriesIndex.groups.length,
    sourceLength: input.sourceLength,
    compactIndex: parsed.compactIndex,
  };
}

function parseInWorkerOrChunks(
  playlistId: string,
  text: string,
  onProgress: ((p: ParseProgress) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<ParsedOutput> {
  const activeWorker = getWorker();
  if (activeWorker) {
    return parseInWorker(activeWorker, playlistId, text, onProgress, signal);
  }
  return parseInChunks(playlistId, text, onProgress, signal);
}

function parseInWorker(
  activeWorker: Worker,
  playlistId: string,
  text: string,
  onProgress: ((p: ParseProgress) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<ParsedOutput> {
  return new Promise<ParsedOutput>((resolve, reject) => {
    const id = ++requestSeq;
    let settled = false;

    const cleanup = (): void => {
      activeWorker.removeEventListener('message', onMessage);
      activeWorker.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new PlaylistFetchError('aborted', 'Request cancelled.'));
    };

    const onMessage = (event: MessageEvent<WorkerOutMessage>): void => {
      if (settled) return;
      const message = event.data;
      if (!message || message.id !== id) return;
      if (message.type === 'progress') {
        onProgress?.({
          stage: 'parse',
          ratio: null,
          detail: `Parsing entries… ${message.entries.toLocaleString()}`,
          entries: message.entries,
        });
        return;
      }
      settled = true;
      cleanup();
      if (message.type === 'done') {
        resolve({
          items: message.items,
          counts: message.counts,
          adultCount: message.adultCount,
          headerName: message.headerName,
          skipped: message.skipped,
          compactIndex: message.compactIndex,
        });
      } else {
        reject(new Error(message.message));
      }
    };

    const onError = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      // Disable the worker permanently and retry on the main thread.
      workerFailed = true;
      worker?.terminate();
      worker = null;
      parseInChunks(playlistId, text, onProgress, signal).then(resolve, reject);
    };

    activeWorker.addEventListener('message', onMessage);
    activeWorker.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });

    const request: ParseRequestMessage = { type: 'parse', id, playlistId, text };
    try {
      activeWorker.postMessage(request);
    } catch {
      onError();
    }
  });
}

/**
 * Main-thread fallback. Still non-blocking: the document is split into
 * manageable slices and the event loop is yielded between them so the spinner
 * keeps animating and the user can still cancel.
 */
async function parseInChunks(
  playlistId: string,
  text: string,
  onProgress: ((p: ParseProgress) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<ParsedOutput> {
  const CHUNK_LINES = 6000;
  const lines = text.split(/\r?\n/);
  const items: ContentItem[] = [];
  let headerName: string | undefined;
  let skipped = 0;

  let cursor = 0;
  while (cursor < lines.length) {
    if (signal?.aborted) throw new PlaylistFetchError('aborted', 'Request cancelled.');
    const end = Math.min(cursor + CHUNK_LINES, lines.length);
    const result = parseM3U(lines.slice(cursor, end).join('\n'), { playlistId });
    if (result.headerName && !headerName) headerName = result.headerName;
    for (const item of result.items) items.push(item);
    skipped += result.skipped;
    cursor = end;

    onProgress?.({
      stage: 'parse',
      ratio: cursor / lines.length,
      detail: `Parsing entries… ${items.length.toLocaleString()}`,
      entries: items.length,
    });
    await yieldToUi();
  }

  onProgress?.({
    stage: 'index',
    ratio: null,
    detail: 'Preparing search…',
    entries: items.length,
  });
  await yieldToUi();

  const tally = tallyItems(items);
  return {
    items,
    counts: tally.counts,
    adultCount: tally.adultCount,
    headerName,
    skipped,
    compactIndex: buildCompactSearchIndex(items),
  };
}

export interface LoadPlaylistInput {
  name: string;
  url: string;
  signal?: AbortSignal;
  onProgress?: (progress: ParseProgress) => void;
  /** Present for refresh; absent for a brand-new playlist. */
  meta?: PlaylistMeta;
  /**
   * The caller's in-memory copy of the previously parsed entries, when it has
   * one. Lets a byte-identical refresh skip parsing entirely. When absent the
   * refresh simply parses as normal.
   */
  previousItems?: readonly ContentItem[];
}

export interface LoadedPlaylist {
  meta: PlaylistMeta;
  items: ContentItem[];
  /**
   * Null only on the unchanged-refresh path, where no parse ran and the caller
   * is expected to keep the index it already holds.
   */
  searchIndex: SearchIndex | null;
  seriesCount: number;
  skipped: number;
  /**
   * True when the downloaded document was byte-identical to the last one, so
   * nothing was re-parsed and the cached entries are still correct.
   */
  unchanged: boolean;
}

/** Full add-or-refresh pipeline, including persistence. */
export async function loadPlaylistFromUrl(input: LoadPlaylistInput): Promise<LoadedPlaylist> {
  const url = validatePlaylistUrl(input.url).toString();

  input.onProgress?.({ stage: 'fetch', ratio: null, detail: 'Downloading playlist…', entries: 0 });
  const { text, length } = await fetchPlaylistText(url, { signal: input.signal });

  const playlistId =
    input.meta?.id ??
    `pl_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const createdAt = input.meta?.createdAt ?? Date.now();

  /*
   * The overwhelmingly common refresh case is a provider that has not changed.
   * Same byte length *and* the caller's cached copy matches the stored item
   * count means the document is identical, so the existing entries, counts and
   * search index are all still correct. Parsing is the expensive part (a
   * 100k-entry playlist is seconds of work), so this is worth the check.
   *
   * The `itemCount > 0` guard matters: an empty previous parse could be a failed
   * one, and re-running it is the right response to that.
   */
  const previous = input.meta;
  // A cached parse is only reusable if it was produced by the current rules.
  const parseFresh = previous?.parseVersion === PARSE_VERSION;
  if (
    previous &&
    parseFresh &&
    previous.itemCount > 0 &&
    previous.sourceLength === length &&
    input.previousItems !== undefined &&
    input.previousItems.length === previous.itemCount
  ) {
    input.onProgress?.({
      stage: 'done',
      ratio: 1,
      detail: 'Playlist is unchanged',
      entries: previous.itemCount,
    });
    const meta: PlaylistMeta = { ...previous, lastUpdated: Date.now(), status: 'ready' };
    await playlistsRepo.save(meta);
    return {
      meta,
      items: input.previousItems as ContentItem[],
      searchIndex: null,
      seriesCount: -1,
      skipped: 0,
      unchanged: true,
    };
  }

  const outcome = await runParse({
    playlistId,
    name: input.name,
    url,
    text,
    sourceLength: length,
    createdAt,
    lastUpdated: Date.now(),
    parentOnly: input.meta?.parentOnly,
    signal: input.signal,
    onProgress: input.onProgress,
  });

  /*
   * A provider that only reshuffled its document produces an equivalent playlist.
   * The in-memory copy the caller already holds stays valid, so skip rewriting
   * the chunked IndexedDB copy — on a large playlist that rewrite is the single
   * most expensive part of a refresh.
   */
  const equivalent =
    parseFresh &&
    shouldSkipRefresh(
      previous
        ? { sourceLength: previous.sourceLength, itemCount: previous.itemCount }
        : undefined,
      { sourceLength: length, itemCount: outcome.items.length },
    );

  if (equivalent && input.previousItems?.length === outcome.items.length) {
    const meta: PlaylistMeta = { ...outcome.meta, lastUpdated: outcome.meta.lastUpdated };
    await playlistsRepo.save(meta);
    return {
      meta,
      items: input.previousItems as ContentItem[],
      searchIndex: null,
      seriesCount: -1,
      skipped: outcome.skipped,
      unchanged: true,
    };
  }

  outcome.meta.chunkCount = await playlistsRepo.saveItems(playlistId, outcome.items);
  await playlistsRepo.save(outcome.meta);

  return {
    meta: outcome.meta,
    items: outcome.items,
    searchIndex: new SearchIndex(outcome.compactIndex, outcome.items),
    seriesCount: outcome.seriesCount,
    skipped: outcome.skipped,
    unchanged: false,
  };
}

/** True when parsing runs off the main thread. Surfaced in Settings. */
export function isWorkerParsingActive(): boolean {
  return !workerFailed && typeof Worker !== 'undefined';
}
