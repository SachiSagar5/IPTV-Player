/**
 * Fatal-error surface for the player.
 *
 * Design rule: the headline is always a plain-language sentence the user can
 * act on. hls.js error objects and MediaError codes are developer detail, so
 * they are collapsed behind a disclosure and never shown as the primary text.
 * The retry button is only offered when recovery is plausible.
 */
import { memo } from 'react';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import type { PlayerErrorInfo } from '@/store/playerStore';

export interface PlayerErrorOverlayProps {
  error: PlayerErrorInfo;
  onRetry: () => void;
  onBack: () => void;
  engineName: string;
}

export const PlayerErrorOverlay = memo(function PlayerErrorOverlay({
  error,
  onRetry,
  onBack,
  engineName,
}: PlayerErrorOverlayProps) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm">
      <div className="animate-scale-in w-full max-w-md text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/12 text-red-400">
          <Icon name="alert" size={26} />
        </span>
        <h2 className="mt-4 text-lg font-bold text-white">Playback stopped</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70">{error.message}</p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <Button onClick={onBack} variant="secondary">
            Go back
          </Button>
          {error.recoverable ? (
            <Button onClick={onRetry} variant="primary" icon="refresh">
              Try again
            </Button>
          ) : null}
        </div>

        {error.detail ? (
          <details className="mt-6 text-left">
            <summary className="cursor-pointer text-[11px] text-white/35 hover:text-white/55">
              Technical details
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-white/10 bg-black/50 p-3 text-[10px] leading-relaxed whitespace-pre-wrap text-white/50">
              {error.detail}
            </pre>
          </details>
        ) : null}

        <p className="mt-4 text-[10px] text-white/25">
          Playback engine: {engineName === 'hls.js' ? 'HLS.js (MSE)' : engineName === 'native' ? 'Native HLS' : 'Direct media'}
          {error.attempts > 0 ? ` · ${error.attempts} recovery attempt(s)` : ''}
        </p>
      </div>
    </div>
  );
});
