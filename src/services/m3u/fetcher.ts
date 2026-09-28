/**
 * Playlist fetching.
 *
 * Every failure mode a user can hit is mapped to a *human* message here — the
 * UI never sees a raw `TypeError: Failed to fetch` or a stack trace.
 */

export class PlaylistFetchError extends Error {
  readonly kind:
    | 'network'
    | 'cors'
    | 'timeout'
    | 'http'
    | 'empty'
    | 'not-playlist'
    | 'too-large'
    | 'aborted'
    | 'invalid-url';

  constructor(kind: PlaylistFetchError['kind'], message: string) {
    super(message);
    this.name = 'PlaylistFetchError';
    this.kind = kind;
  }
}

export interface FetchPlaylistOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Guard against pathological playlists; 40 MB is well above any real M3U. */
  maxBytes?: number;
}

const DEFAULT_TIMEOUT = 45_000;
const DEFAULT_MAX_BYTES = 40 * 1024 * 1024;

/** Cheap synchronous guard so obviously bad input never becomes a request. */
export function validatePlaylistUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new PlaylistFetchError('invalid-url', 'Please enter an M3U URL.');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new PlaylistFetchError(
      'invalid-url',
      'That does not look like a valid URL. Include http:// or https://',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PlaylistFetchError('invalid-url', 'Only http:// and https:// URLs are supported.');
  }
  return url;
}

export interface FetchedPlaylist {
  text: string;
  /** Raw source length, used for the "unchanged, skip re-parse" fast path. */
  length: number;
}

export async function fetchPlaylistText(
  url: string,
  options: FetchPlaylistOptions = {},
): Promise<FetchedPlaylist> {
  const {
    timeoutMs = DEFAULT_TIMEOUT,
    signal,
    maxBytes = DEFAULT_MAX_BYTES,
  } = options;

  const parsed = validatePlaylistUrl(url);

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) throw new PlaylistFetchError('aborted', 'Request cancelled.');
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      credentials: 'omit',
      // A conditional request lets a CDN answer 304 and skip a re-parse.
      cache: 'default',
    });
  } catch (error) {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
    if (signal?.aborted) {
      throw new PlaylistFetchError('aborted', 'Request cancelled.');
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PlaylistFetchError(
        'timeout',
        `The playlist took longer than ${Math.round(timeoutMs / 1000)}s to respond.`,
      );
    }
    throw new PlaylistFetchError(
      'network',
      'Could not reach the server. Check your internet connection and try again.',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }

  if (!response.ok) {
    throw new PlaylistFetchError(
      'http',
      response.status === 404
        ? 'Playlist not found (404). Check the URL.'
        : `The server responded with an error (${response.status}).`,
    );
  }

  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PlaylistFetchError(
      'too-large',
      'That playlist is larger than 40 MB. Please choose a smaller playlist.',
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PlaylistFetchError('timeout', 'Downloading the playlist timed out.');
    }
    throw new PlaylistFetchError(
      'cors',
      'The playlist could not be read. The server may be blocking cross-origin requests (CORS).',
    );
  }

  if (text.length > maxBytes) {
    throw new PlaylistFetchError('too-large', 'That playlist is larger than 40 MB.');
  }

  if (text.trim().length === 0) {
    throw new PlaylistFetchError('empty', 'The playlist is empty.');
  }

  if (!text.includes('#EXTM3U') && !/^https?:\/\//im.test(text.slice(0, 4096))) {
    throw new PlaylistFetchError(
      'not-playlist',
      'That URL did not return an M3U playlist.',
    );
  }

  return { text, length: text.length };
}

/** Map a low-level error to a message safe to render. */
export function describeError(error: unknown): string {
  if (error instanceof PlaylistFetchError) return error.message;
  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError') {
      return 'Not enough device storage to save this playlist.';
    }
    if (error.name === 'AbortError') return 'The operation was cancelled.';
    return 'Something went wrong. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}
