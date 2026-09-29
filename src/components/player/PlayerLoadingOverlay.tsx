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
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3">
      <Spinner size={28} />
      <p className="text-xs font-medium text-white/70">
        {status === 'loading' ? 'Connecting to stream' : 'Buffering'}
      </p>
      {isLive && status === 'buffering' ? (
        <p className="text-[11px] text-white/40">Live streams take a moment to start</p>
      ) : null}
    </div>
  );
});