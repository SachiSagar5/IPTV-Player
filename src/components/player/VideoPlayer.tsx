/**
 * The video player.
 *
 * Architecture: this component owns a single `<video>` element and an HlsEngine.
 * The engine selects the right playback path:
 *   - HLS via hls.js (with ABR) on Chrome/Firefox/Edge
 *   - Native HLS on Safari/iOS
 *   - Native <video> for progressive formats (MP4, WebM, etc.)
 * Communicates upward through local state. Can be swapped for a native
 * Android/Media3 implementation later without touching pages.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ContentItem } from '@/types';
import { playerStore } from '@/store/playerStore';
import type { PlayerErrorInfo } from '@/store/playerStore';
import { HlsEngine } from '@/services/hls/hlsEngine';
import { PlayerControls } from './PlayerControls';
import { PlayerErrorOverlay } from './PlayerErrorOverlay';
import { PlayerLoadingOverlay } from './PlayerLoadingOverlay';
import { usePlayerKeys } from './usePlayerKeys';
import { useFullscreen, usePictureInPicture } from './useFullscreen';
import {
  markWatched,
  noteStreamFailure,
  saveProgress,
  useAppSelector,
} from '@/store/appStore';
import { formatEpisodeLabel } from '@/utils/format';

const PROXY_ENDPOINT = 'https://iptv-cors-proxy.beautiful-raisin.workers.dev/';

function buildProxyUrl(targetUrl: string): string {
  return `${PROXY_ENDPOINT}${targetUrl}`;
}

function shouldUseProxy(url: string): boolean {
  if (typeof window === 'undefined') return false;
  const isHttpsPage = window.location.protocol === 'https:';
  const isHttpUrl = url.startsWith('http://');
  return isHttpsPage && isHttpUrl;
}

function getPlayableUrl(sourceUrl: string): string {
  return shouldUseProxy(sourceUrl) ? buildProxyUrl(sourceUrl) : sourceUrl;
}

export interface VideoPlayerProps {
  item: ContentItem;
  startPosition?: number;
  onEnded?: (item: ContentItem) => void;
  onBack?: () => void;
  children?: ReactNode;
}

const PROGRESS_SAVE_INTERVAL_MS = 5000;
const MIN_RESUME_SECONDS = 15;

export const VideoPlayer = memo(function VideoPlayer({
  item,
  startPosition = 0,
  onEnded,
  onBack,
  children,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<HlsEngine | null>(null);
  const navigate = useNavigate();
  const settings = useAppSelector((s) => s.settings);
  const [error, setError] = useState<PlayerErrorInfo | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'error' | 'ended'>('idle');
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolumeState] = useState(settings.defaultVolume);
  const [muted, setMutedState] = useState(settings.defaultVolume === 0);
  const [playbackRate, setPlaybackRateState] = useState(settings.defaultPlaybackRate);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [engineName, setEngineName] = useState<'hls.js' | 'native' | 'progressive' | 'none'>('none');
  const [levels, setLevels] = useState<Array<{ index: number; label: string; height: number; bitrate: number }>>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [autoLevelEnabled, setAutoLevelEnabled] = useState(true);
  const [fitMode, setFitMode] = useState<'contain' | 'cover' | 'fill' | 'none'>('contain');
  const [audioTracks, setAudioTracks] = useState<Array<{ id: number; label: string; lang: string }>>([]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState(-1);
  const introSkippedRef = useRef(false);
  const playableUrl = getPlayableUrl(item.streams[0]?.url ?? '');
  const resumeRef = useRef(startPosition);

  const fullscreen = useFullscreen(videoRef);
  const pip = usePictureInPicture(mediaRef);

  // Define callbacks before using them in usePlayerKeys
  const togglePlay = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) void media.play().catch(() => undefined);
    else media.pause();
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.duration === Infinity) {
      const bufferedEnd = media.buffered.length ? media.buffered.end(media.buffered.length - 1) : 0;
      media.currentTime = Math.max(0, bufferedEnd - 5);
      return;
    }
    media.currentTime = Math.max(0, Math.min(seconds, media.duration || 0));
  }, []);

  const seekBy = useCallback((deltaSeconds: number) => {
    const media = mediaRef.current;
    if (!media) return;
    seekTo(media.currentTime + deltaSeconds);
  }, [seekTo]);

  const setVolume = useCallback((value: number) => {
    const media = mediaRef.current;
    if (!media) return;
    const clamped = Math.max(0, Math.min(1, value));
    media.volume = clamped;
    media.muted = clamped === 0;
  }, []);

  const toggleMute = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.muted = !media.muted;
  }, []);

  const setRate = useCallback((rate: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.playbackRate = rate;
  }, []);

  const setLevel = useCallback((index: number) => {
    engineRef.current?.setLevel(index);
    setCurrentLevel(index);
    setAutoLevelEnabled(index < 0);
  }, []);

  const setAudioTrack = useCallback((index: number) => {
    engineRef.current?.setAudioTrack(index);
    setCurrentAudioTrack(index);
  }, []);

  const retry = useCallback(() => {
    const media = mediaRef.current;
    if (!media || !playableUrl) return;
    setError(null);
    setStatus('loading');
    engineRef.current?.retry();
  }, [playableUrl]);

  const exit = useCallback(() => {
    if (fullscreen.isFullscreen) fullscreen.exit();
    if (onBack) onBack();
    else navigate(-1);
  }, [fullscreen, onBack, navigate]);

  const cycleFitMode = useCallback(() => {
    setFitMode((current) => {
      const modes: Array<'contain' | 'cover' | 'fill' | 'none'> = ['contain', 'cover', 'fill', 'none'];
      const idx = modes.indexOf(current);
      return modes[(idx + 1) % modes.length];
    });
  }, []);

  const { showControls, hideControls } = usePlayerKeys({
    onTogglePlay: togglePlay,
    onSeekBy: seekBy,
    onVolume: setVolume,
    onToggleMute: toggleMute,
    onRate: (delta) => {
      const current = mediaRef.current?.playbackRate ?? 1;
      const next = Math.max(0.25, Math.min(3, Math.round((current + delta) * 4) / 4));
      setRate(next);
    },
    onCycleSubtitles: () => {},
    onToggleFullscreen: fullscreen.toggle,
    onTogglePip: pip.toggle,
    onBack: exit,
    onCycleFitMode: cycleFitMode,
    setControlsVisible,
  });

  // Initialize HlsEngine
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const engine = new HlsEngine({
      onLevels: (ls) => {
        setLevels(ls);
        setAutoLevelEnabled(ls.length > 1);
      },
      onLevelChange: (index) => {
        setCurrentLevel(index);
      },
      onAudioTracks: (tracks) => {
        setAudioTracks(tracks);
      },
      onAudioTrackChange: (index) => {
        setCurrentAudioTrack(index);
      },
      onSubtitleTracks: () => {},
      onFatalError: (err) => {
        setError(err);
        setStatus('error');
        noteStreamFailure(item, err);
      },
      onRecovered: () => {
        setError(null);
        setStatus('playing');
      },
      onFeaturesDetected: (_features) => {
        // Features are read from engineRef.current.streamFeatures in render
      },
    });

    engine.attach(media);
    engineRef.current = engine;
    setEngineName(engine.engineName);

    const source = { url: playableUrl };
    engine.load(source, {
      defaultLevel: settings.defaultQuality,
      startPosition: resumeRef.current,
    });

    return () => {
      persistProgress(media, item);
      engine.destroy();
      engineRef.current = null;
    };
  }, [item.id, playableUrl, settings.defaultQuality]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !playableUrl) return;

    const onLoadedMetadata = (): void => {
      const dur = media.duration;
      setDuration(Number.isFinite(dur) ? dur : 0);
      setStatus('paused');

      const pending = engineRef.current?.takePendingSeek() ?? resumeRef.current;
      if (pending > 0 && media.currentTime < 1) {
        try { media.currentTime = pending; } catch {}
      }

      // Auto-skip 1:30 if starting from beginning (no resume position)
      if (pending === 0 && resumeRef.current === 0 && item.kind !== 'live') {
        try { media.currentTime = 90; } catch {}
        introSkippedRef.current = true;
      }

      void media.play().catch(() => { setStatus('paused'); });
    };

    const onDurationChange = (): void => {
      setDuration(Number.isFinite(media.duration) ? media.duration : 0);
    };

    const onTimeUpdate = (): void => {
      setCurrentTime(media.currentTime);
    };

    const onProgress = (): void => {
      const buf = media.buffered.length ? media.buffered.end(media.buffered.length - 1) : 0;
      setBuffered(buf);
    };

    const onPlay = (): void => setStatus('playing');
    const onPause = (): void => {
      persistProgress(media, item);
      setStatus('paused');
    };
    const onWaiting = (): void => {
      if (status !== 'error') setStatus('buffering');
    };
    const onPlaying = (): void => {
      setStatus('playing');
      showControls();
    };
    const onVolumeChange = (): void => {
      setVolumeState(media.volume);
      setMutedState(media.muted);
    };
    const onRateChange = (): void => setPlaybackRateState(media.playbackRate);
    const onEndedInternal = (): void => {
      setStatus('ended');
      void saveProgress(item, 0, 0, 0);
      onEnded?.(item);
    };
    const onMediaError = (): void => {
      const code = media.error?.code;
      const message =
        code === 4
          ? 'The browser refused this stream. Usually the provider blocks cross-origin requests or serves it over plain http from an https page; less often the file uses HEVC (H.265) or E-AC3 audio, which browsers do not decode but VLC does.'
          : code === 2
            ? 'The connection dropped while playing. Check your network and try again.'
            : 'Playback failed. The stream may be offline or temporarily unavailable.';
      const err: PlayerErrorInfo = { message, recoverable: true, attempts: 0 };
      setError(err);
      setStatus('error');
      noteStreamFailure(item, { ...err, recoverable: code !== 4 });
    };

    media.addEventListener('loadedmetadata', onLoadedMetadata);
    media.addEventListener('durationchange', onDurationChange);
    media.addEventListener('timeupdate', onTimeUpdate);
    media.addEventListener('progress', onProgress);
    media.addEventListener('play', onPlay);
    media.addEventListener('playing', onPlaying);
    media.addEventListener('pause', onPause);
    media.addEventListener('waiting', onWaiting);
    media.addEventListener('volumechange', onVolumeChange);
    media.addEventListener('ratechange', onRateChange);
    media.addEventListener('ended', onEndedInternal);
    media.addEventListener('error', onMediaError);

    markWatched(item, formatEpisodeLabel(item.season, item.episode));

    return () => {
      media.removeEventListener('loadedmetadata', onLoadedMetadata);
      media.removeEventListener('durationchange', onDurationChange);
      media.removeEventListener('timeupdate', onTimeUpdate);
      media.removeEventListener('progress', onProgress);
      media.removeEventListener('play', onPlay);
      media.removeEventListener('playing', onPlaying);
      media.removeEventListener('pause', onPause);
      media.removeEventListener('waiting', onWaiting);
      media.removeEventListener('volumechange', onVolumeChange);
      media.removeEventListener('ratechange', onRateChange);
      media.removeEventListener('ended', onEndedInternal);
      media.removeEventListener('error', onMediaError);
    };
  }, [item.id]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const timer = setInterval(() => persistProgress(media, item), PROGRESS_SAVE_INTERVAL_MS);
    return () => { clearInterval(timer); persistProgress(media, item); };
  }, [item]);

  useEffect(() => {
    const save = () => { const media = mediaRef.current; if (media) persistProgress(media, item); };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', save);
    return () => { window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', save); };
  }, [item]);

  useEffect(() => {
    setEngineName(engineRef.current?.engineName ?? 'none');
  }, []);

  useEffect(() => {
    playerStore.patch({ fullscreen: fullscreen.isFullscreen });
  }, [fullscreen.isFullscreen]);
  useEffect(() => {
    playerStore.patch({ pictureInPicture: pip.isActive });
  }, [pip.isActive]);

  return (
    <div className="flex min-h-dvh flex-col bg-black">
      <div
        ref={videoRef}
        className="relative flex-1 bg-black"
        onMouseMove={showControls}
        onMouseLeave={hideControls}
        onTouchStart={showControls}
      >
        <video
          ref={mediaRef}
          className="h-full max-h-[100dvh] w-full bg-black"
          style={{ objectFit: fitMode }}
          playsInline
          controls={false}
          preload="auto"
          tabIndex={-1}
          aria-label={item.name}
        />

        <PlayerLoadingOverlay status={status} isLive={item.kind === 'live'} hasError={!!error} />

        {error ? (
          <PlayerErrorOverlay error={error} onRetry={retry} onBack={exit} engineName={engineName} />
        ) : null}

        <PlayerControls
          visible={controlsVisible}
          item={item}
          status={status}
          duration={duration}
          currentTime={currentTime}
          buffered={buffered}
          volume={volume}
          muted={muted}
          playbackRate={playbackRate}
          onTogglePlay={togglePlay}
          onSeek={seekTo}
          onSeekBy={seekBy}
          onVolume={setVolume}
          onToggleMute={toggleMute}
          onRate={setRate}
          onLevel={setLevel}
          onAudioTrack={setAudioTrack}
          onFitMode={cycleFitMode}
          onBack={exit}
          onToggleFullscreen={fullscreen.toggle}
          onTogglePip={pip.toggle}
          pipSupported={pip.isSupported}
          canGoBack={Boolean(onBack) || window.history.length > 1}
          engineName={engineName}
          levels={levels}
          currentLevel={currentLevel}
          autoLevelEnabled={autoLevelEnabled}
          audioTracks={audioTracks}
          currentAudioTrack={currentAudioTrack}
          streamFeatures={engineRef.current?.streamFeatures ?? {
            hdr: 'none',
            dolby: 'none',
            codec: 'none',
            resolution: 'unknown',
          }}
        />

        {status === 'idle' ? (
          <p className="absolute inset-0 z-10 flex items-center justify-center text-sm text-white/60">
            Nothing selected
          </p>
        ) : null}
      </div>

      {children ? (
        <div className="border-t border-ink-800 bg-ink-950">{children}</div>
      ) : null}
    </div>
  );
});

function persistProgress(media: HTMLMediaElement, item: ContentItem): void {
  if (item.kind === 'live') return;
  const duration = media.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const position = media.currentTime;
  if (position < MIN_RESUME_SECONDS) return;
  void saveProgress(item, position, duration, 0);
}

export { MIN_RESUME_SECONDS };