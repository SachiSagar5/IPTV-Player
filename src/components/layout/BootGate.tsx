/**
 * Boot gate.
 *
 * Blocks the routed UI until IndexedDB hydration finishes, so no page ever
 * renders against a half-loaded playlist and then snaps into place. It also
 * surfaces the two states a user can actually hit: no IndexedDB at all, and no
 * playlists saved yet.
 */
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Spinner } from '@/components/common/Button';
import { ErrorState } from '@/components/common/States';
import { PlaylistOnboarding } from '@/pages/Playlists/PlaylistOnboarding';
import { useAppSelector } from '@/store/appStore';

export function BootGate({ children }: { children: ReactNode }) {
  const hydrated = useAppSelector((s) => s.hydrated);
  const hydrationError = useAppSelector((s) => s.hydrationError);
  const playlistCount = useAppSelector((s) => s.playlists.length);
  const [dbBlocked, setDbBlocked] = useState(false);

  useEffect(() => {
    const handleBlocked = () => setDbBlocked(true);
    window.addEventListener('indexeddb-blocked', handleBlocked);
    return () => window.removeEventListener('indexeddb-blocked', handleBlocked);
  }, []);

  if (!hydrated) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink-950">
        <div className="flex flex-col items-center gap-3 text-mist-500 px-4">
          <Spinner size={26} className="text-accent-400" />
          <p className="text-xs font-medium tracking-[0.16em] uppercase">
            {dbBlocked ? 'Waiting for other tabs…' : 'Loading library'}
          </p>
          {dbBlocked && (
            <p className="text-xs text-center max-w-xs text-[#8b93a7]">
              Another tab has the database open. Close other IPTV Player tabs and reload, or wait for them to finish.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (hydrationError) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink-950 px-4">
        <ErrorState
          title={hydrationError.includes('timed out') ? 'Loading timed out' : 'Local storage is unavailable'}
          message={
            hydrationError.includes('not available')
              ? 'This browser blocked local storage, so playlists and watch progress cannot be saved. Enable site data for this site, or try a private window with storage allowed.'
              : hydrationError.includes('timed out')
                ? 'Close other IPTV Player tabs and reload this page. If the problem persists, clear site data for this domain.'
                : hydrationError
          }
          icon="alert"
        />
      </div>
    );
  }

  // First run: no playlist means there is nothing to show, so go straight to
  // the add-playlist flow rather than rendering seven empty pages.
  if (playlistCount === 0) {
    return <PlaylistOnboarding />;
  }

  return <>{children}</>;
}
