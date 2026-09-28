/**
 * App shell: fixed chrome, routed outlet, global error banner, boot gate.
 *
 * This component deliberately imports **no** page. Route-level code splitting is
 * declared once, in `src/routes.tsx`, so a page can never be pulled into the
 * main bundle just because the shell mentions it. The outlet is rendered inside
 * a single `Suspense` boundary so a late-arriving chunk never causes a layout
 * shift — the header and the padding are already in place when it lands.
 */
import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { TopNav } from '@/components/navigation/TopNav';
import { ErrorBanner } from './ErrorBanner';
import { BootGate } from './BootGate';
import { RouteFallback } from './RouteFallback';
import { ErrorBoundary } from './ErrorBoundary';

export function AppLayout() {
  const location = useLocation();
  // The player owns the full viewport, so the shell hides its own chrome there.
  const isPlayer = location.pathname === '/watch' || location.pathname.startsWith('/watch/');

  // Reset scroll on navigation, but not for the player (which owns its own).
  useEffect(() => {
    if (isPlayer) return;
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname, isPlayer]);

  return (
    <BootGate>
      <div className="min-h-dvh bg-ink-950">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-jade-500 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-1000"
        >
          Skip to content
        </a>

        {isPlayer ? null : <TopNav />}
        <ErrorBanner />

        <main
          id="main"
          className={isPlayer ? '' : 'pt-14 pb-20 md:pt-16 md:pb-0'}
        >
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </BootGate>
  );
}
