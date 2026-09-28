/**
 * HLS engine — the only module that talks to hls.js or to native HLS.
 *
 * Responsibilities kept here (and out of React):
 *  - Engine selection: hls.js everywhere except Safari/iOS, which decode HLS
 *    natively. Using hls.js on Safari fights Media Source Extensions and is the
 *    single most common cause of "quality selector is empty" on iOS.
 *  - Error classification and bounded recovery. hls.js's documented recovery
 *    ladder is followed, and every attempt is counted so a dead stream fails
 *    fast instead of retrying forever.
 *  - Track/level enumeration, reported from the *manifest* only. We never
 *    invent a quality or audio track the stream does not contain.
 */
import type Hls from 'hls.js';
import type {
  ErrorData,
  Level,
  ManifestParsedData,
  MediaPlaylist,
  HlsConfig,
  LoaderContext,
} from 'hls.js';
import { classifyStream, isNativeHlsSupported } from './nativeSupport';
import type { StreamSource } from '@/types';
import type {
  AudioTrackInfo,
  PlayerErrorInfo,
  QualityLevel,
  SubtitleTrackInfo,
} from '@/store/playerStore';

export interface HlsEngineEvents {
  onLevels: (levels: QualityLevel[]) => void;
  onLevelChange: (index: number) => void;
  onAudioTracks: (tracks: AudioTrackInfo[]) => void;
  /**
   * The audio rendition actually playing, as an index into the engine's own
   * track list. Reported by the engine rather than assumed by the UI: hls.js
   * picks a rendition itself (DEFAULT/AUTOSELECT, and it falls back when one
   * 404s), so "what the user last clicked" is not the same question as "what is
   * playing". -1 means the muxed audio in the video renditions.
   */
  onAudioTrackChange: (index: number) => void;
  onSubtitleTracks: (tracks: SubtitleTrackInfo[]) => void;
  onFatalError: (error: PlayerErrorInfo) => void;
  onRecovered: () => void;
}

const MAX_RECOVERY_ATTEMPTS = 3;

export { isNativeHlsSupported };

/**
 * hls.js is ~180 KB gzipped and only needed once a stream is actually opened, so
 * it is code-split behind a dynamic import. The promise is cached module-level so
 * the second and later streams reuse the same instance from the HTTP cache
 * rather than re-evaluating the chunk.
 */
let hlsModulePromise: Promise<typeof import('hls.js')> | null = null;

function loadHlsJs(): Promise<typeof import('hls.js')> {
  hlsModulePromise ??= import('hls.js');
  return hlsModulePromise;
}

/**
 * `1080p` / `720p` / `480p`, derived only from levels the manifest declares.
 * `position` is the index in `hls.levels`, which is what `currentLevel` takes.
 * `Level.id` is a *URL* id and must never be used for selection.
 */
function levelLabel(level: Level, position: number): string {
  if (level.height) return `${level.height}p`;
  if (level.bitrate) return `${Math.round(level.bitrate / 1000)} kbps`;
  return `Level ${position + 1}`;
}

function buildLevels(levels: Level[]): QualityLevel[] {
  return levels
    .map((level, position) => ({
      index: position,
      label: levelLabel(level, position),
      height: level.height ?? 0,
      bitrate: level.bitrate ?? 0,
    }))
    .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
}

/**
 * hls.js reports alternate renditions as a flat `MediaPlaylist[]`, where the
 * array position is what `hls.audioTrack` / `hls.subtitleTrack` accept. The
 * `id` is a media-playlist id, so it is *not* interchangeable with the index;
 * the UI selects by index and this maps back to labels.
 *
 * Renditions are de-duplicated on `lang|name` because a lot of IPTV manifests
 * repeat the same audio track once per variant level.
 */
function buildTracks(
  tracks: MediaPlaylist[] | undefined,
  kind: 'Audio' | 'Subtitle',
): { id: number; label: string; lang: string }[] {
  if (!tracks || tracks.length === 0) return [];
  const seen = new Set<string>();
  const out: { id: number; label: string; lang: string }[] = [];
  for (let position = 0; position < tracks.length; position++) {
    const track = tracks[position];
    // HLS puts muxed-in audio in the manifest as an "instream" (SCTE-20/CEA-608)
    // pseudo-track. It is not a selectable audio rendition.
    if (track.instreamId) continue;
    const lang = track.lang ?? '';
    const name = track.name ?? '';
    const key = `${lang}|${name}|${track.url}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      // Position within the *source* array, not the filtered one: the store uses
      // this as the value passed straight back to `setAudioTrack`.
      id: position,
      label: name || lang || `${kind} ${position + 1}`,
      lang,
    });
  }
  return out;
}

function buildAudioTracks(tracks: MediaPlaylist[] | undefined): AudioTrackInfo[] {
  return buildTracks(tracks, 'Audio');
}

function buildSubtitleTracks(tracks: MediaPlaylist[] | undefined): SubtitleTrackInfo[] {
  return buildTracks(tracks, 'Subtitle');
}

export class HlsEngine {
  private hls: Hls | null = null;
  /** hls.js's class statics (`Events`, `ErrorTypes`), available after a load. */
  private HlsCtor: typeof Hls | null = null;
  private video: HTMLVideoElement | null = null;
  private source: StreamSource | null = null;
  private events: HlsEngineEvents;
  private recoveryAttempts = 0;
  private usingNative = false;
  private usingProgressive = false;
  private destroyed = false;
  /** Detaches the native track listeners installed for Safari's late track list. */
  private nativeTrackCleanup: (() => void) | null = null;
  /** Resume position handed to us at load time, consumed once playback starts. */
  private pendingSeek = 0;
  /**
   * Monotonic token guarding the async hls.js load. A user who skips three
   * channels in two seconds would otherwise get three live `Hls` instances
   * fighting over the same `<video>`; only the newest token may attach.
   */
  private loadToken = 0;

  constructor(events: HlsEngineEvents) {
    this.events = events;
  }

  get engineName(): 'hls.js' | 'native' | 'progressive' | 'none' {
    if (this.hls) return 'hls.js';
    if (this.usingProgressive) return 'progressive';
    if (this.usingNative) return 'native';
    return 'none';
  }

  attach(video: HTMLVideoElement): void {
    this.video = video;
  }

  /** Tear down any existing session without touching the store. */
  private teardown(): void {
    this.nativeTrackCleanup?.();
    this.nativeTrackCleanup = null;
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.HlsCtor = null;
    this.usingNative = false;
    this.usingProgressive = false;
    this.recoveryAttempts = 0;
    this.pendingSeek = 0;
  }

  load(source: StreamSource, options: { defaultLevel: number; startPosition: number }): void {
    const video = this.video;
    if (!video) return;
    this.destroyed = false;
    const token = ++this.loadToken;
    this.teardown();
    this.source = source;
    this.recoveryAttempts = 0;

    if (!source.url) {
      this.events.onFatalError({
        message: 'This stream has no playable URL.',
        recoverable: false,
        attempts: 0,
      });
      return;
    }

    // The engine follows the *URL*, not just the platform. Deciding by platform
    // alone sent every progressive file through hls.js, which parses its input as
    // an M3U8 manifest and so rejects a perfectly playable MP4 with
    // "manifest is not valid M3U8" — the single biggest source of "works in VLC,
    // fails here" reports from real-world playlists.
    const shape = classifyStream(source.url);

    if (shape.kind === 'unsupported') {
      this.events.onFatalError({
        message: `This is a ${shape.label} file, which no browser can decode. VLC, Kodi or a desktop player will open it; a web player cannot.`,
        detail: `Container .${shape.ext} is outside the set browsers can demux.`,
        recoverable: false,
        attempts: 0,
      });
      return;
    }

    // Progressive formats go straight to the media element on *every* browser,
    // not just Safari. `<video>` is the only thing that can play them, and this
    // path also reports the native track list and the resume position.
    if (shape.kind === 'progressive') {
      this.loadDirect(source, options.startPosition, 'progressive');
      return;
    }

    // Safari/iOS have no Media Source Extensions, so the platform decoder is the
    // only option there. Everywhere else hls.js is preferred because it is the
    // only path that exposes quality levels and alternate audio renditions.
    // Deciding this *before* the dynamic import keeps Safari from paying for a
    // chunk it will never use.
    if (isNativeHlsSupported()) {
      this.loadDirect(source, options.startPosition, 'native');
      return;
    }

    void this.loadWithHlsJs(source, options, token);
  }

  private loadDirect(
    source: StreamSource,
    startPosition: number,
    mode: 'native' | 'progressive',
  ): void {
    const video = this.video;
    if (!video) return;
    this.usingNative = true;
    this.usingProgressive = mode === 'progressive';
    video.src = source.url;
    if (startPosition > 0) {
      const onLoaded = (): void => {
        video.removeEventListener('loadedmetadata', onLoaded);
        try {
          video.currentTime = startPosition;
        } catch {
          /* seeking before metadata is safe to ignore */
        }
      };
      video.addEventListener('loadedmetadata', onLoaded);
    }
    // Native HLS exposes tracks through the media element, not hls.js.
    //
    // Safari populates `audioTracks` only *after* the manifest has been parsed,
    // so reading them once here returns an empty list and the audio menu never
    // appears. Re-read on `loadedmetadata` and on `change`, which Safari fires
    // whenever the track list is (re)built.
    const readTracks = (): void => {
      if (this.destroyed || this.hls) return;
      this.events.onAudioTracks(readNativeAudioTracks(video));
      this.events.onSubtitleTracks(readNativeSubtitleTracks(video));
      this.events.onAudioTrackChange(readNativeAudioTrackIndex(video));
    };
    readTracks();
    video.addEventListener('loadedmetadata', readTracks);
    video.addEventListener('change', readTracks);
    this.nativeTrackCleanup = () => {
      video.removeEventListener('loadedmetadata', readTracks);
      video.removeEventListener('change', readTracks);
    };
    this.events.onLevels([]);
  }

  private async loadWithHlsJs(
    source: StreamSource,
    options: { defaultLevel: number; startPosition: number },
    token: number,
  ): Promise<void> {
    let HlsCtor: typeof Hls;
    try {
      ({ default: HlsCtor } = await loadHlsJs());
    } catch (error) {
      if (this.destroyed || token !== this.loadToken) return;
      this.events.onFatalError({
        message: 'The HLS player engine could not be loaded.',
        detail: error instanceof Error ? error.message : String(error),
        recoverable: true,
        attempts: 0,
      });
      return;
    }

    // The user moved on (or the component unmounted) while the chunk downloaded.
    if (this.destroyed || token !== this.loadToken) return;

    if (!HlsCtor.isSupported()) {
      // No Media Source Extensions and no native HLS. Progressive files never
      // reach this point — `load` hands them to the media element first.
      this.events.onFatalError({
        message: 'This browser cannot play HLS streams. Try Chrome, Edge, or Firefox.',
        recoverable: false,
        attempts: 0,
      });
      return;
    }

    const hls = new HlsCtor({
      // Buffering strategy. The defaults are tuned for a desktop broadband
      // connection; for IPTV the provider's CDN behaviour matters more than the
      // nominal bandwidth, so we keep buffers generous but not unbounded.
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      backBufferLength: 30,
      maxBufferSize: 60 * 1000 * 1000,
      // Resume slightly behind the live edge rather than at it, which is what
      // avoids a stall on a slow join.
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
      enableWorker: true,
      lowLatencyMode: true,
      // -1 means "let ABR pick". The engine receives the array *position*, which
      // is what `startLevel` expects.
      startLevel: options.defaultLevel,
      // The very first manifest is often slow; a generous timeout avoids a
      // spurious "unable to play" while a CDN warms up.
      manifestLoadingTimeOut: 25_000,
      manifestLoadingMaxRetry: 3,
      levelLoadingTimeOut: 20_000,
      fragLoadingTimeOut: 30_000,
      fragLoadingMaxRetry: 4,
      // Some IPTV providers still mark segments as AES-128 with a plaintext key.
      enableSoftwareAES: true,
      // Applied per request; must be part of the config, not assigned later.
      xhrSetup: buildXhrSetup(source),
      fetchSetup: buildFetchSetup(source),
    });

    this.hls = hls;
    this.HlsCtor = HlsCtor;

    hls.on(HlsCtor.Events.MANIFEST_PARSED, (_event, data: ManifestParsedData) => {
      if (this.destroyed) return;
      this.events.onLevels(buildLevels(data.levels ?? []));
      this.events.onAudioTracks(buildAudioTracks(data.audioTracks));
      this.events.onSubtitleTracks(buildSubtitleTracks(data.subtitleTracks));
      // hls.js has already chosen a rendition by this point; report that rather
      // than leaving the UI on "nothing selected".
      this.events.onAudioTrackChange(hls.audioTrack);

      if (options.defaultLevel >= 0 && hls.levels[options.defaultLevel]) {
        hls.currentLevel = options.defaultLevel;
      }
    });

    hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_event, data) => {
      if (this.destroyed) return;
      this.events.onLevelChange(data.level);
    });

    hls.on(HlsCtor.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
      if (this.destroyed) return;
      this.events.onAudioTracks(buildAudioTracks(data.audioTracks));
      // The list was rebuilt, so both the available tracks and the current
      // selection have to be re-reported.
      this.events.onAudioTrackChange(hls.audioTrack);
      this.events.onLevelChange(hls.currentLevel);
    });

    // Fired when hls.js itself swaps rendition (a group disappears, or the
    // selected one fails and it falls back). Without this the menu would keep
    // claiming a track that is no longer playing.
    hls.on(HlsCtor.Events.AUDIO_TRACK_SWITCHED, () => {
      if (this.destroyed) return;
      this.events.onAudioTrackChange(hls.audioTrack);
    });

    hls.on(HlsCtor.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
      if (this.destroyed) return;
      this.events.onSubtitleTracks(buildSubtitleTracks(data.subtitleTracks));
    });

    hls.on(HlsCtor.Events.ERROR, (_event, data: ErrorData) => {
      if (this.destroyed) return;
      this.handleError(data);
    });

    hls.loadSource(source.url);
    if (this.video) hls.attachMedia(this.video);

    if (options.startPosition > 0) {
      // hls.js cannot seek before the manifest is known, so the position is
      // handed to the player and applied once the element reports it can seek.
      this.pendingSeek = options.startPosition;
    }
  }


  /**
   * hls.js's documented recovery ladder, with a hard attempt ceiling.
   *
   * The ladder is: network errors resume the pipeline, media errors ask the
   * demuxer to flush and recover. What hls.js does *not* do is give up, so a
   * dead origin would spin forever. Every error — fatal or not — counts, and
   * once the budget is gone the user gets a real message and a Retry button
   * instead of an infinite spinner.
   */
  private handleError(data: ErrorData): void {
    const hls = this.hls;
    const errorTypes = this.HlsCtor?.ErrorTypes;
    if (!hls || !errorTypes) return;

    this.recoveryAttempts += 1;
    const exhausted = this.recoveryAttempts > MAX_RECOVERY_ATTEMPTS;

    if (data.type === errorTypes.NETWORK_ERROR) {
      if (exhausted) {
        this.events.onFatalError({
          message:
            'This stream stopped responding. The provider\u2019s server may be offline or overloaded.',
          detail: describeNetworkError(data),
          recoverable: true,
          attempts: this.recoveryAttempts,
        });
        return;
      }
      if (data.fatal) {
        // Resume the media pipeline without refetching the manifest.
        hls.startLoad();
      }
      return;
    }

    if (data.type === errorTypes.MEDIA_ERROR) {
      if (exhausted) {
        this.events.onFatalError({
          message: 'The video data could not be decoded. The stream may be corrupted.',
          detail: describeMediaError(data),
          recoverable: true,
          attempts: this.recoveryAttempts,
        });
        return;
      }
      if (data.fatal) hls.recoverMediaError();
      return;
    }

    // Manifest parse failures, DRM, unsupported containers: not recoverable here.
    this.events.onFatalError({
      message: 'This stream is in a format this player cannot handle.',
      detail: data.details ?? data.type,
      recoverable: false,
      attempts: this.recoveryAttempts,
    });
  }

  /**
   * A resume position that could not be applied at load time, consumed by the
   * player once the element reports it can seek.
   */
  takePendingSeek(): number {
    const position = this.pendingSeek;
    this.pendingSeek = 0;
    return position;
  }

  /** Called by the UI when the user presses Retry. */
  retry(): void {
    if (!this.source) return;
    const video = this.video;
    if (!video) return;
    this.recoveryAttempts = 0;
    if (this.hls) {
      this.hls.stopLoad();
      this.hls.startLoad(-1);
    } else if (this.usingProgressive) {
      // Re-assigning `src` is what actually retries a direct file; calling
      // `play()` alone would just rethrow the same network error.
      video.load();
    }
    void video.play().catch(() => {
      /* autoplay may be blocked; the user can press play */
    });
  }

  /** Full reload of the same stream (used by the "Retry" button on errors). */
  reload(): void {
    if (!this.source || !this.video) return;
    this.load(this.source, { defaultLevel: -1, startPosition: 0 });
  }

  setLevel(index: number): void {
    if (!this.hls) return;
    this.hls.currentLevel = index;
  }

  getLevel(): number {
    return this.hls?.currentLevel ?? -1;
  }

  /** `index` is a position in `hls.audioTracks`; -1 restores the muxed track. */
  setAudioTrack(index: number): void {
    if (!this.hls) {
      // Native path (Safari): selection lives on the media element.
      if (this.video) {
        setNativeAudioTrack(this.video, index);
        this.events.onAudioTrackChange(readNativeAudioTrackIndex(this.video));
      }
      return;
    }
    this.hls.audioTrack = index;
    // Read back rather than echoing the request: hls.js clamps out-of-range
    // values and can substitute a fallback when a rendition is unavailable.
    this.events.onAudioTrackChange(this.hls.audioTrack);
  }

  setSubtitleTrack(index: number): void {
    if (!this.hls) return;
    if (index < 0) {
      this.hls.subtitleDisplay = false;
      return;
    }
    this.hls.subtitleDisplay = true;
    this.hls.subtitleTrack = index;
  }

  getAudioTrack(): number {
    if (!this.hls) return this.video ? readNativeAudioTrackIndex(this.video) : -1;
    return this.hls.audioTrack;
  }

  getSubtitleTrack(): number {
    return this.hls?.subtitleDisplay ? (this.hls?.subtitleTrack ?? -1) : -1;
  }

  setSubtitleDisplay(enabled: boolean): void {
    if (this.hls) this.hls.subtitleDisplay = enabled;
  }

  destroy(): void {
    this.destroyed = true;
    this.loadToken += 1;
    this.teardown();
    this.source = null;
    this.events = {
      onLevels: () => {},
      onLevelChange: () => {},
      onAudioTracks: () => {},
      onAudioTrackChange: () => {},
      onSubtitleTracks: () => {},
      onFatalError: () => {},
      onRecovered: () => {},
    };
  }
}

/** Safari's `HTMLMediaElement.audioTracks`: non-standard, absent from lib.dom. */
interface NativeAudioTrackList {
  readonly length: number;
  [index: number]: { label: string; language: string; enabled: boolean };
}

/** Safari exposes alternate audio renditions on the element, not via hls.js. */
export function readNativeAudioTracks(video: HTMLVideoElement): AudioTrackInfo[] {
  const tracks = (video as unknown as { audioTracks?: NativeAudioTrackList }).audioTracks;
  if (!tracks || tracks.length === 0) return [];
  const out: AudioTrackInfo[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (!track) continue;
    out.push({
      id: i,
      label: track.label || track.language || `Audio ${i + 1}`,
      lang: track.language ?? '',
    });
  }
  return out;
}

/** Selects an alternate audio rendition on the native (Safari) path. */
export function setNativeAudioTrack(video: HTMLVideoElement, index: number): void {
  const list = (video as unknown as {
    audioTracks?: NativeAudioTrackList & { [index: number]: { enabled: boolean } };
  }).audioTracks;
  if (!list) return;
  for (let i = 0; i < list.length; i++) {
    const track = list[i];
    if (track) track.enabled = i === index;
  }
}

/**
 * The enabled native rendition, as an index into the media element's own list —
 * the same numbering `readNativeAudioTracks` reports. -1 when there is no list
 * or nothing is enabled, which the UI shows as "Default".
 */
export function readNativeAudioTrackIndex(video: HTMLVideoElement): number {
  const tracks = (video as unknown as { audioTracks?: NativeAudioTrackList }).audioTracks;
  if (!tracks || tracks.length === 0) return -1;
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (track && track.enabled) return i;
  }
  return -1;
}

export function readNativeSubtitleTracks(video: HTMLVideoElement): SubtitleTrackInfo[] {
  const list = video.textTracks;
  if (!list || list.length === 0) return [];
  const out: SubtitleTrackInfo[] = [];
  for (let i = 0; i < list.length; i++) {
    const track = list[i];
    if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
    out.push({
      id: i,
      label: track.label || track.language || `Subtitle ${i + 1}`,
      lang: track.language ?? '',
    });
  }
  return out;
}

/**
 * `User-Agent`, `Referer`, `Origin`, `Host` and `Connection` are forbidden
 * request headers: a browser silently drops them from `setRequestHeader`, and
 * some throw outright. So the only headers that can actually reach a provider
 * are the ones the playlist author put in the URL, or ones the provider chose
 * to ignore the absence of. Building the list anyway (and skipping at send
 * time) keeps the intent documented without pretending it works.
 */
const FORBIDDEN_HEADERS = new Set(['user-agent', 'referer', 'origin', 'host', 'connection']);

function collectHeaders(source: StreamSource): Record<string, string> {
  const headers: Record<string, string> = {};
  if (source.userAgent) headers['User-Agent'] = source.userAgent;
  if (source.referrer) headers.Referer = source.referrer;
  if (source.origin) headers.Origin = source.origin;
  if (source.headers) {
    for (const [name, value] of Object.entries(source.headers)) {
      if (FORBIDDEN_HEADERS.has(name.toLowerCase())) continue;
      if (typeof value !== 'string' || value.length === 0) continue;
      headers[name] = value;
    }
  }
  return headers;
}

function buildXhrSetup(source: StreamSource): HlsConfig['xhrSetup'] {
  const headers = collectHeaders(source);
  const names = Object.keys(headers);
  if (names.length === 0) return undefined;
  return (xhr: XMLHttpRequest) => {
    for (const name of names) {
      if (FORBIDDEN_HEADERS.has(name.toLowerCase())) continue;
      try {
        xhr.setRequestHeader(name, headers[name] as string);
      } catch {
        /* forbidden by the user agent */
      }
    }
  };
}

function buildFetchSetup(source: StreamSource): HlsConfig['fetchSetup'] {
  const headers = collectHeaders(source);
  const names = Object.keys(headers).filter((name) => !FORBIDDEN_HEADERS.has(name.toLowerCase()));
  if (names.length === 0) return undefined;
  return (context: LoaderContext) => {
    // hls.js hands us the headers it already intends to send; we only add ours,
    // so a per-range `Range` header is never clobbered.
    const merged: Record<string, string> = { ...(context.headers ?? {}) };
    for (const name of names) {
      const value = headers[name];
      if (value !== undefined) merged[name] = value;
    }
    return new Request(context.url, { ...context, headers: merged });
  };
}

function describeNetworkError(data: ErrorData): string {
  switch (data.details) {
    case 'manifestLoadError':
      return 'The stream manifest could not be downloaded.';
    case 'manifestLoadTimeOut':
      return 'The stream manifest timed out.';
    case 'manifestParsingError':
      return 'The stream manifest is not valid M3U8.';
    case 'levelLoadError':
      return 'A quality level could not be downloaded.';
    case 'fragLoadError':
      return 'A video segment could not be downloaded.';
    case 'fragLoadTimeOut':
      return 'A video segment timed out.';
    default:
      return data.details ?? 'Network error';
  }
}

function describeMediaError(data: ErrorData): string {
  switch (data.details) {
    case 'bufferAppendError':
      return 'The media buffer could not be extended.';
    case 'bufferAddCodecError':
      return 'The browser does not support this codec.';
    case 'bufferAppendingError':
      return 'The media buffer was rejected.';
    case 'bufferFullError':
      return 'The media buffer overflowed.';
    default:
      return data.details ?? 'Media error';
  }
}
