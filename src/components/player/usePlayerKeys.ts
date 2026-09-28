/**
 * Keyboard model for the player.
 *
 * Deliberately mirrors what a TV remote sends, so the same code path serves a
 * keyboard today and an Android TV D-pad tomorrow:
 *
 *   Space / K        play-pause          ← →   seek ±10s (live: ±30s)
 *   ↑ ↓              volume              J L   seek ∓10s
 *   M                mute                F     fullscreen
 *   C / V            subtitle track      < >   playback rate
 *   P                picture-in-picture  Esc   back (fullscreen first)
 *
 * Controls auto-hide after 3s of inactivity while playing, and reappear on any
 * key or pointer movement. When they are hidden, a single tap toggles them back.
 */
import { useCallback, useEffect, useRef } from 'react';
import { playerStore, usePlayerSelector } from '@/store/playerStore';

const AUTO_HIDE_MS = 3000;
const SEEK_STEP = 10;
const LIVE_SEEK_STEP = 30;

export interface PlayerKeyHandlers {
  onTogglePlay: () => void;
  onSeekBy: (delta: number) => void;
  onVolume: (value: number) => void;
  onToggleMute: () => void;
  onRate: (delta: number) => void;
  onCycleSubtitles: () => void;
  onToggleFullscreen: () => void;
  onTogglePip: () => void;
  onBack: () => void;
}

export interface UsePlayerKeysResult {
  controlsVisible: boolean;
  showControls: () => void;
  hideControls: () => void;
  toggleControls: () => void;
}

export function usePlayerKeys(handlers: Partial<PlayerKeyHandlers> = {}): UsePlayerKeysResult {
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(handlers);
  latest.current = handlers;

  const clearTimer = useCallback(() => {
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearTimer();
    const state = playerStore.getState();
    // Never auto-hide while paused, buffering, or showing an error: the user
    // needs those controls to recover.
    if (state.status === 'paused' || state.status === 'error' || state.status === 'loading') {
      return;
    }
    hideTimer.current = setTimeout(() => {
      playerStore.patch({ controlsVisible: false });
    }, AUTO_HIDE_MS);
  }, [clearTimer]);

  const showControls = useCallback(() => {
    playerStore.patch({ controlsVisible: true });
    scheduleHide();
  }, [scheduleHide]);

  const hideControls = useCallback(() => {
    clearTimer();
    playerStore.patch({ controlsVisible: false });
  }, [clearTimer]);

  const toggleControls = useCallback(() => {
    if (playerStore.getState().controlsVisible) hideControls();
    else showControls();
  }, [hideControls, showControls]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      // Never steal keys from a text field or an open menu.
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('[role="menu"]'))
      ) {
        return;
      }

      const h = latest.current;
      const state = playerStore.getState();
      let handled = true;

      switch (event.key) {
        case ' ':
        case 'Spacebar':
        case 'k':
        case 'K':
          h.onTogglePlay?.();
          break;
        case 'ArrowLeft':
        case 'j':
        case 'J':
          h.onSeekBy?.(state.isLive ? -LIVE_SEEK_STEP : -SEEK_STEP);
          break;
        case 'ArrowRight':
        case 'l':
        case 'L':
          h.onSeekBy?.(state.isLive ? LIVE_SEEK_STEP : SEEK_STEP);
          break;
        case 'ArrowUp':
          h.onVolume?.(Math.min(1, state.volume + 0.05));
          break;
        case 'ArrowDown':
          h.onVolume?.(Math.max(0, state.volume - 0.05));
          break;
        case 'm':
        case 'M':
          h.onToggleMute?.();
          break;
        case 'f':
        case 'F':
          h.onToggleFullscreen?.();
          break;
        case 'c':
        case 'C':
        case 'v':
        case 'V':
          h.onCycleSubtitles?.();
          break;
        case 'p':
        case 'P':
          h.onTogglePip?.();
          break;
        case '>':
        case '.':
          h.onRate?.(0.25);
          break;
        case '<':
        case ',':
          h.onRate?.(-0.25);
          break;
        case 'Escape':
          // Fullscreen first; a remote's Back button must never exit the app
          // directly out of fullscreen.
          if (state.fullscreen) h.onToggleFullscreen?.();
          else h.onBack?.();
          break;
        default:
          handled = false;
      }

      if (handled) {
        event.preventDefault();
        showControls();
      } else {
        // Any other key still reveals the controls.
        if (playerStore.getState().controlsVisible) scheduleHide();
      }
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') showControls();
    };

    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimer();
    };
  }, [showControls, scheduleHide, clearTimer]);

  return {
    controlsVisible: usePlayerSelector((s) => s.controlsVisible),
    showControls,
    hideControls,
    toggleControls,
  };
}
