/** Shown while a lazily-loaded route chunk is in flight. */
import { SkeletonRow } from '@/components/common/States';

export function RouteFallback() {
  return (
    <div className="space-y-10 py-8" aria-busy="true" aria-label="Loading page">
      <div className="px-4 md:px-8">
        <div className="skeleton h-8 w-56 rounded" />
        <div className="skeleton mt-3 h-3 w-80 max-w-full rounded" />
      </div>
      <div className="space-y-2">
        <div className="skeleton mx-4 h-3 w-24 rounded md:mx-8" />
        <SkeletonRow count={7} />
      </div>
      <div className="space-y-2">
        <div className="skeleton mx-4 h-3 w-24 rounded md:mx-8" />
        <SkeletonRow count={7} />
      </div>
    </div>
  );
}
