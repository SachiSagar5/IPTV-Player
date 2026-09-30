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
 *
 * The one rule this hook adds for a remote: if focus is sitting on a control in
 * the bar, the D-pad owns the arrow keys and this hook does not. Otherwise a
 * single press on a focused "forward 10 seconds" button would both move focus
 * along the bar *and* seek, because the two listeners are independent. OK
 * activation still works — that is the browser's own behaviour for a focused
 * `<button>`, which is exactly what a remote's centre key produces.
 */
import { useCallback, useEffect, useRef } from 'react';

const AUTO_HIDE_MS = 3000;
const SEEK_STEP = 10;

/** The control bar, marked by `PlayerControls`. */
const CONTROLS_SELECTOR = '[data-player-controls]';

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
  onCycleFitMode: () => void;
  setControlsVisible: (visible: boolean) => void;
}

export interface UsePlayerKeysResult {
  showControls: () => void;
  hideControls: () => void;
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
    hideTimer.current = setTimeout(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest(CONTROLS_SELECTOR)) return;
      latest.current.setControlsVisible?.(false);
    }, AUTO_HIDE_MS);
  }, [clearTimer]);

  const showControls = useCallback(() => {
    latest.current.setControlsVisible?.(true);
    scheduleHide();
  }, [scheduleHide]);

  const hideControls = useCallback(() => {
    clearTimer();
    latest.current.setControlsVisible?.(false);
  }, [clearTimer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;

      if (target?.closest(CONTROLS_SELECTOR)) {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(event.key)) {
          return;
        }
      }

      const h = latest.current;

      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          event.preventDefault();
          h.onTogglePlay?.();
          break;
        case 'ArrowLeft':
        case 'j':
        case 'J':
          event.preventDefault();
          h.onSeekBy?.(-SEEK_STEP);
          break;
        case 'ArrowRight':
        case 'l':
        case 'L':
          event.preventDefault();
          h.onSeekBy?.(SEEK_STEP);
          break;
        case 'ArrowUp':
          event.preventDefault();
          h.onVolume?.(Math.min(1, 1 + 0.1));
          break;
        case 'ArrowDown':
          event.preventDefault();
          h.onVolume?.(Math.max(0, 1 - 0.1));
          break;
        case 'm':
        case 'M':
          event.preventDefault();
          h.onToggleMute?.();
          break;
        case 'f':
        case 'F':
          event.preventDefault();
          h.onToggleFullscreen?.();
          break;
        case 'p':
        case 'P':
          event.preventDefault();
          h.onTogglePip?.();
          break;
        case 'c':
        case 'C':
          event.preventDefault();
          h.onCycleSubtitles?.();
          break;
        case 'v':
        case 'V':
          event.preventDefault();
          h.onCycleSubtitles?.();
          break;
        case 'z':
        case 'Z':
          event.preventDefault();
          h.onCycleFitMode?.();
          break;
        case ',':
        case '<':
          event.preventDefault();
          h.onRate?.(-0.25);
          break;
        case '.':
        case '>':
          event.preventDefault();
          h.onRate?.(0.25);
          break;
        case 'Escape':
          h.onBack?.();
          break;
        default:
          return;
      }
      h.setControlsVisible?.(true);
      scheduleHide();
    };

    const onFocusIn = (): void => {
      latest.current.setControlsVisible?.(true);
      scheduleHide();
    };

    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearTimer();
        latest.current.setControlsVisible?.(false);
      }
    });
    document.addEventListener('focusin', onFocusIn);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onFocusIn);
      document.removeEventListener('focusin', onFocusIn);
      clearTimer();
    };
  }, [clearTimer, scheduleHide]);

  return {
    showControls,
    hideControls,
  };
}