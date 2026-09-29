import { memo } from 'react';
import { Spinner } from '@/components/common/Button';

interface PlayerLoadingOverlayProps {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'error' | 'ended';
  isLive: boolean;
  hasError: boolean;
}

export const PlayerLoadingOverlay = memo(function PlayerLoadingOverlay({
  status,
  isLive,
  hasError,
}: PlayerLoadingOverlayProps) {
  if (hasError || (status !== 'loading' && status !== 'buffering')) return null;

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4">
      <div className="flex flex-col items-center gap-3">
        <Spinner size={36} className="text-accent-400 drop-shadow-[0_0_16px_rgb(var(--accent-400-rgb)/0.4)]" />
        <p className="text-xs font-medium text-white/80">
          {status === 'loading' ? 'Connecting to stream' : 'Buffering'}
        </p>
      </div>
      {isLive && status === 'buffering' ? (
        <p className="text-[11px] text-white/50 max-w-xs text-center">Live streams take a moment to start</p>
      ) : null}
    </div>
  );
});