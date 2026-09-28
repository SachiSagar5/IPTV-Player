/**
 * Spinner / buffering surface.
 *
 * Kept separate from PlayerErrorOverlay so the two can never both be mounted:
 * the spinner only paints while the status is `loading` or `buffering` and no
 * error is present.
 */
import { memo } from 'react';
import { usePlayerSelector } from '@/store/playerStore';
import { Spinner } from '@/components/common/Button';

export const PlayerLoadingOverlay = memo(function PlayerLoadingOverlay() {
  const status = usePlayerSelector((s) => s.status);
  const isLive = usePlayerSelector((s) => s.isLive);
  const hasError = usePlayerSelector((s) => s.error !== null);
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
