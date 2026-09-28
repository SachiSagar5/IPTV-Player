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
import { useAppSelector } from '@/store/appStore';

export function AppLayout() {
  const location = useLocation();
  // The player owns the full viewport, so the shell hides its own chrome there.
  const isPlayer = location.pathname.startsWith('/watch');
  // The Settings switch for this exists, and `index.css` already carries the
  // `.reduce-motion` rules that implement it — nothing was ever toggling the
  // class, so the preference silently did nothing. Wiring it here means one
  // class on the root covers every page, including the ones loaded lazily.
  const reducedMotion = useAppSelector((s) => s.settings.reducedMotion);

  // Reset scroll on navigation, but not for the player (which owns its own).
  useEffect(() => {
    if (isPlayer) return;
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname, isPlayer]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('reduce-motion', reducedMotion);
    return () => root.classList.remove('reduce-motion');
  }, [reducedMotion]);

  return (
    <BootGate>
      <div className="relative min-h-dvh">
        <BackdropAurora />

        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-accent-500 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-1000"
        >
          Skip to content
        </a>

        {isPlayer ? null : <TopNav />}
        <ErrorBanner />

        <main
          id="main"
          className={isPlayer ? 'relative' : 'relative pt-14 pb-20 md:pt-16 md:pb-0'}
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

/**
 * Decorative light pools behind the whole app.
 *
 * `body` already carries a static wash, which is enough on its own; these add
 * the slow-moving layer that makes a long browse page feel lit rather than
 * painted. Two elements total, `aria-hidden`, `pointer-events-none`, and behind
 * everything via `z-0` on a `relative` parent — so they never intercept a
 * click or a D-pad focus step.
 */
function BackdropAurora() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="animate-drift-a absolute -top-[30vh] -left-[10vw] h-[70vh] w-[70vw] rounded-full bg-accent-500/8 blur-[120px]" />
      <div className="animate-drift-b absolute -top-[22vh] right-[-14vw] h-[62vh] w-[62vw] rounded-full bg-sky-500/7 blur-[130px]" />
    </div>
  );
}
