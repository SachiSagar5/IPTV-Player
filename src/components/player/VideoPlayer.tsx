/**
 * The video player.
 *
 * Architecture: this component owns a single `<video>` element and a single
 * `HlsEngine`. It is the ONLY place in the app that touches media APIs, and it
 * communicates upward exclusively through the player store. That split is what
 * lets the player be swapped for a native Android/Media3 implementation later
 * without touching a single page: pages read `playerStore`, never hls.js.
 *
 * Error handling follows the spec's requirement of bounded recovery: a fatal
 * HLS error triggers a short retry ladder inside the engine, and if that fails
 * the user gets a plain-language message plus Retry / Back. Raw hls.js error
 * text is kept in a collapsed disclosure, never shown as the headline.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ContentItem } from '@/types';
import { HlsEngine } from '@/services/hls/hlsEngine';
import { playerStore, usePlayerSelector } from '@/store/playerStore';
import type { PlayerErrorInfo } from '@/store/playerStore';
import { PlayerControls } from './PlayerControls';
import { PlayerErrorOverlay } from './PlayerErrorOverlay';
import { PlayerLoadingOverlay } from './PlayerLoadingOverlay';
import { usePlayerKeys } from './usePlayerKeys';
import { useFullscreen, usePictureInPicture } from './useFullscreen';
import {
  clearStreamFailure,
  markWatched,
  noteStreamFailure,
  saveProgress,
  useAppSelector,
} from '@/store/appStore';
import { formatEpisodeLabel } from '@/utils/format';

export interface VideoPlayerProps {
  item: ContentItem;
  /** Seconds to resume from; 0 starts from the beginning. */
  startPosition?: number;
  onEnded?: (item: ContentItem) => void;
  onBack?: () => void;
  /** Rendered below the video (episode list, next-episode card). */
  children?: ReactNode;
}

const PROGRESS_SAVE_INTERVAL_MS = 5000;
/** Below this, a "resume" would be a jarring 1-second skip. */
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
  const [engineName, setEngineName] = useState<'hls.js' | 'native' | 'progressive' | 'none'>(
    'none',
  );

  const fullscreen = useFullscreen(videoRef);
  const pip = usePictureInPicture(mediaRef);

  // Start position is captured once per mount; a later change must not seek.
  const resumeRef = useRef(startPosition);

  /* ---------------- engine lifecycle ---------------- */

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const engine = new HlsEngine({
      onLevels: (levels) => {
        playerStore.patch((s) => {
          if (s.item?.id !== item.id) return {};
          return {
            levels,
            autoLevelEnabled: levels.length > 1 ? s.autoLevelEnabled : true,
          };
        });
      },
      onLevelChange: (index) => {
        playerStore.patch((s) => (s.item?.id === item.id ? { currentLevel: index } : {}));
      },
      onAudioTracks: (tracks) => {
        playerStore.patch((s) => (s.item?.id === item.id ? { audioTracks: tracks } : {}));
      },
      onAudioTrackChange: (index) => {
        playerStore.patch((s) =>
          s.item?.id === item.id ? { currentAudioTrack: index } : {},
        );
      },
      onSubtitleTracks: (tracks) => {
        playerStore.patch((s) => (s.item?.id === item.id ? { subtitleTracks: tracks } : {}));
      },
      onFatalError: (error) => {
        playerStore.patch((s) => (s.item?.id === item.id ? { error, status: 'error' } : {}));
        // The engine has already exhausted its recovery ladder, so this is the
        // point where a live channel's failure is worth remembering.
        noteStreamFailure(item, error);
      },
      onRecovered: () => {
        playerStore.patch((s) =>
          s.item?.id === item.id ? { status: 'playing', error: null } : {},
        );
        // It came back, so whatever it recorded on the way in no longer holds.
        clearStreamFailure(item.id);
      },
    });

    engine.attach(media);
    engineRef.current = engine;
    setEngineName(engine.engineName);

    const source = item.streams[0];
    engine.load(source, {
      defaultLevel: settings.defaultQuality,
      startPosition: resumeRef.current,
    });

    return () => {
      // Persist whatever the user watched before tearing anything down.
      persistProgress(media, item);
      engine.destroy();
      engineRef.current = null;
    };
    // `settings.defaultQuality` and `resumeRef` are launch-time values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.streams]);

  /* ---------------- initial player state ---------------- */

  useEffect(() => {
    const source = item.streams[0];
    playerStore.setState((previous) => ({
      ...previous,
      item,
      status: 'loading',
      error: null,
      currentTime: 0,
      duration: 0,
      buffered: 0,
      liveLatency: 0,
      isLive: item.kind === 'live',
      levels: [],
      currentLevel: settings.defaultQuality,
      autoLevelEnabled: settings.defaultQuality < 0,
      audioTracks: [],
      currentAudioTrack: -1,
      subtitleTracks: [],
      currentSubtitleTrack: -1,
      subtitlesEnabled: false,
      volume: settings.defaultVolume,
      muted: settings.defaultVolume === 0,
      playbackRate: settings.defaultPlaybackRate,
      startedAt: Date.now(),
      watchedSec: 0,
      controlsVisible: true,
      fullscreen: false,
      pictureInPicture: false,
      ...(source ? {} : {}),
    }));

    markWatched(item, formatEpisodeLabel(item.season, item.episode));

    return () => {
      // Leaving the player resets transient state but keeps user data.
      playerStore.setState((previous) => ({ ...previous, item: null, status: 'idle' }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  /* ---------------- media element events ---------------- */

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const patch = (partial: Parameters<typeof playerStore.patch>[0]): void => {
      playerStore.patch(partial);
    };

    const onLoadedMetadata = (): void => {
      const duration = media.duration;
      patch({
        duration: Number.isFinite(duration) ? duration : 0,
        isLive: item.kind === 'live',
        status: 'paused',
      });

      // Apply the resume point. The native path already seeked before this event,
      // so only seek when we are effectively still at the start; otherwise a
      // second seek would land in the wrong place on a slow `loadedmetadata`.
      const pending = engineRef.current?.takePendingSeek() ?? resumeRef.current;
      if (pending > 0 && media.currentTime < 1) {
        try {
          media.currentTime = pending;
        } catch {
          // Live streams and some MSE states refuse a seek until they can seek.
        }
      }
      // Autoplay: browsers require a gesture unless the media is muted, so
      // failure here is expected and simply leaves the player paused.
      void media.play().catch(() => {
        patch({ status: 'paused' });
      });
    };

    const onDurationChange = (): void => {
      patch({ duration: Number.isFinite(media.duration) ? media.duration : 0 });
    };

    const onTimeUpdate = (): void => {
      patch({ currentTime: media.currentTime });
      // Live latency: how far behind the live edge we are.
      if (media.duration === Infinity) {
        const bufferedEnd = media.buffered.length
          ? media.buffered.end(media.buffered.length - 1)
          : media.currentTime;
        patch({ liveLatency: Math.max(0, bufferedEnd - media.currentTime) });
      }
    };

    const onProgress = (): void => {
      const buffered = media.buffered.length
        ? media.buffered.end(media.buffered.length - 1)
        : 0;
      patch({ buffered });
    };

    const onPlay = (): void => patch({ status: 'playing' });
    const onPause = (): void => {
      persistProgress(media, item);
      patch({ status: 'paused' });
    };
    const onWaiting = (): void => {
      // Never overwrite an error state with a spinner.
      patch((s) => (s.status === 'error' ? {} : { status: 'buffering' }));
    };
    const onPlaying = (): void => {
      patch({ status: 'playing' });
      // Frames are actually arriving, which is the only reliable proof the
      // channel is worth keeping. Cheap no-op when nothing is recorded.
      clearStreamFailure(item.id);
    };
    const onVolumeChange = (): void => {
      patch({ volume: media.volume, muted: media.muted });
    };
    const onRateChange = (): void => patch({ playbackRate: media.playbackRate });
    const onEndedInternal = (): void => {
      patch({ status: 'ended' });
      // Finished: drop the resume point and offer the next episode.
      void saveProgress(item, 0, 0, 0);
      onEnded?.(item);
    };
    const onMediaError = (): void => {
      const code = media.error?.code;
      const message =
        code === 4 /* MEDIA_ERR_SRC_NOT_SUPPORTED */
          ? 'The file loaded, but this browser cannot decode it. Direct MP4s from IPTV providers are often HEVC (H.265) or E-AC3 audio, which Chrome and Safari do not support — VLC does.'
          : code === 2 /* MEDIA_ERR_NETWORK */
            ? 'The connection dropped while playing. Check your network and try again.'
            : 'Playback failed. The stream may be offline or temporarily unavailable.';
      const error: PlayerErrorInfo = { message, recoverable: true, attempts: 0 };
      patch({ error, status: 'error' });
      // A decode/network error on the element itself never reaches the engine's
      // error handler, so without this a live channel that dies here would stay
      // in the list forever, failing the same way on every visit.
      noteStreamFailure(item, { ...error, recoverable: code !== 4 });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  /* ---------------- periodic progress persistence ---------------- */

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const timer = setInterval(() => {
      persistProgress(media, item);
    }, PROGRESS_SAVE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      persistProgress(media, item);
    };
  }, [item]);

  // Last-chance save when the tab is hidden or the page goes away.
  useEffect(() => {
    const save = (): void => {
      const media = mediaRef.current;
      if (media) persistProgress(media, item);
    };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', save);
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', save);
    };
  }, [item]);

  /* ---------------- imperative controls ---------------- */

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
      // Live: a "seek" means jump to the live edge minus a small offset.
      const bufferedEnd = media.buffered.length
        ? media.buffered.end(media.buffered.length - 1)
        : 0;
      media.currentTime = Math.max(0, bufferedEnd - 5);
      return;
    }
    media.currentTime = Math.max(0, Math.min(seconds, media.duration || 0));
  }, []);

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const media = mediaRef.current;
      if (!media) return;
      seekTo(media.currentTime + deltaSeconds);
    },
    [seekTo],
  );

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
    playerStore.patch({ currentLevel: index, autoLevelEnabled: index < 0 });
  }, []);

  const setAudioTrack = useCallback((index: number) => {
    // The engine reports back what actually took effect (it clamps and can fall
    // back when a rendition is unavailable) via `onAudioTrackChange`, so the
    // store is *not* updated with the requested index here.
    engineRef.current?.setAudioTrack(index);
  }, []);

  const setSubtitleTrack = useCallback((index: number) => {
    engineRef.current?.setSubtitleTrack(index);
    playerStore.patch({ currentSubtitleTrack: index, subtitlesEnabled: index >= 0 });
  }, []);

  const cycleSubtitles = useCallback(() => {
    const state = playerStore.getState();
    if (state.subtitleTracks.length === 0) return;
    // -1 (off) → track 0 → ... → back to off.
    const next =
      !state.subtitlesEnabled || state.currentSubtitleTrack < 0
        ? state.subtitleTracks[0]?.id ?? -1
        : state.currentSubtitleTrack + 1 < state.subtitleTracks.length
          ? state.subtitleTracks[state.currentSubtitleTrack + 1].id
          : -1;
    engineRef.current?.setSubtitleTrack(next);
    playerStore.patch({ currentSubtitleTrack: next, subtitlesEnabled: next >= 0 });
  }, []);

  const retry = useCallback(() => {
    playerStore.patch({ error: null, status: 'loading' });
    // A hard decode/manifest problem needs a full reload; a stall does not.
    engineRef.current?.reload();
  }, []);

  const exit = useCallback(() => {
    if (fullscreen.isFullscreen) fullscreen.exit();
    if (onBack) onBack();
    else navigate(-1);
  }, [fullscreen, onBack, navigate]);

  const { controlsVisible, showControls, hideControls } = usePlayerKeys({
    onTogglePlay: togglePlay,
    onSeekBy: seekBy,
    onVolume: setVolume,
    onToggleMute: toggleMute,
    onRate: (delta) => {
      const current = mediaRef.current?.playbackRate ?? 1;
      const next = Math.max(0.25, Math.min(3, Math.round((current + delta) * 4) / 4));
      setRate(next);
    },
    onCycleSubtitles: cycleSubtitles,
    onToggleFullscreen: fullscreen.toggle,
    onTogglePip: pip.toggle,
    onBack: exit,
  });

  /* ---------------- render ---------------- */

  const status = usePlayerSelector((s) => s.status);
  const error = usePlayerSelector((s) => s.error);

  // Keep the store's view of fullscreen / PiP in sync with the DOM.
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
          className="h-full max-h-[100dvh] w-full bg-black object-contain"
          playsInline
          // No native `controls`: the custom bar is the only UI, which keeps
          // behaviour identical on desktop, mobile and a future TV shell.
          controls={false}
          preload="metadata"
          crossOrigin="anonymous"
          tabIndex={-1}
          aria-label={item.name}
        />

        <PlayerLoadingOverlay />

        {error ? (
          <PlayerErrorOverlay
            error={error}
            onRetry={retry}
            onBack={exit}
            engineName={engineName}
          />
        ) : null}

        <PlayerControls
          visible={controlsVisible}
          item={item}
          onTogglePlay={togglePlay}
          onSeek={seekTo}
          onSeekBy={seekBy}
          onVolume={setVolume}
          onToggleMute={toggleMute}
          onRate={setRate}
          onLevel={setLevel}
          onAudioTrack={setAudioTrack}
          onSubtitleTrack={setSubtitleTrack}
          onBack={exit}
          onToggleFullscreen={fullscreen.toggle}
          onTogglePip={pip.toggle}
          pipSupported={pip.isSupported}
          canGoBack={Boolean(onBack) || window.history.length > 1}
          engineName={engineName}
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

/**
 * Persist position. Guarded so an unstarted stream never writes a bogus 0/0
 * record, and live TV never writes progress at all.
 */
function persistProgress(media: HTMLMediaElement, item: ContentItem): void {
  if (item.kind === 'live') return;
  const duration = media.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const position = media.currentTime;
  if (position < MIN_RESUME_SECONDS) return;
  void saveProgress(item, position, duration, 0);
}

export { MIN_RESUME_SECONDS };
