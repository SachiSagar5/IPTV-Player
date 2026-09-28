/**
 * App shell: fixed chrome, routed outlet, global error banner, boot gate.
 *
 * This component deliberately imports **no** page. Route-level code splitting is
 * declared once, in `src/routes.tsx`, so a page can never be pulled into the
 * main bundle just because the shell mentions it. The outlet is rendered inside
 * a single `Suspense` boundary so a late-arriving chunk never causes a layout
 * shift — the header and the padding are already in place when it lands.
 */
import { Suspense, useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { TopNav } from '@/components/navigation/TopNav';
import { ErrorBanner } from './ErrorBanner';
import { BootGate } from './BootGate';
import { RouteFallback } from './RouteFallback';
import { ErrorBoundary } from './ErrorBoundary';
import { useAppSelector } from '@/store/appStore';
import { useDpadNavigation } from '@/hooks/useDpadNavigation';
import { installNativeBack } from '@/tv/nativeBack';
import { useRouteFocus } from '@/tv/useRouteFocus';

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
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

  /**
   * The outermost D-pad context, wrapping the nav and the page.
   *
   * Every other container is a page root, a row or a grid, and all of them sit
   * inside `<main>`. That left the header outside every navigable container:
   * a remote could Tab into the nav and then not move at all, because the
   * handlers all ignore a keypress whose target is outside themselves. Worse,
   * the header and the content are separate subtrees, so there was no path
   * *between* them in either direction — pressing Down from the nav found no
   * target below it, and pressing Up from the first row found no target above.
   *
   * This container is that path. It is a fallback rather than a replacement:
   * `keydown` bubbles outwards, so a row or grid resolves the press first and
   * marks it handled, and this only steps in when the inner context ran out.
   */
  const shellRef = useRef<HTMLDivElement>(null);
  useDpadNavigation(shellRef, { loop: false });

  // Each route needs somewhere for focus to land, or the D-pad has nothing to
  // move from. Native only; the browser's own behaviour is left untouched.
  useRouteFocus();

  // Android hardware Back. No-op in a browser, where Back is the browser's.
  useEffect(() => installNativeBack((delta) => navigate(delta)), [navigate]);

  return (
    <BootGate>
      <div ref={shellRef} className="relative min-h-dvh">
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
