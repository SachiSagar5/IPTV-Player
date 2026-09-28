import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { isNativeShell } from './platform';
import { navCandidates } from '@/hooks/navCandidates';

/**
 * Where focus lands when a route changes.
 *
 * On a remote this is not a nicety, it is the difference between a usable app
 * and a dead one. Navigating with the D-pad moves focus, but a route change
 * replaces the DOM that held it, so focus falls back to `<body>`. Arrows are
 * then delivered to nothing, because every navigable container in the app
 * ignores a keypress whose target is outside itself. The user presses Right
 * after choosing a movie and nothing happens at all.
 *
 * So on the native shell each route gets an explicit landing spot: the first
 * navigable element in the page content. The browser already does something
 * equivalent for keyboard users and its own heuristics are fine, so this is
 * native-only — the web build behaves exactly as it did before.
 */
export function useRouteFocus(): void {
  const { pathname } = useLocation();

  useEffect(() => {
    if (!isNativeShell()) return;
    // The player owns its own focus (the video element is `tabindex="-1"` and
    // the control bar is a separate D-pad container) and has no landing card.
    if (pathname.startsWith('/watch')) return;
    // A dialog opened on top of the new route already decides where focus goes.
    if (document.querySelector('dialog[open]')) return;

    // Two frames: one for React to commit, one for the lazy row's
    // `IntersectionObserver` to have mounted the cards it renders.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const main = document.getElementById('main');
        if (!main) return;
        // Only claim focus if the user has not already moved it themselves.
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body && main.contains(active)) return;

        // Shared with the D-pad hook, so the landing element is always one the
        // arrow keys can actually reach from.
        navCandidates(main)[0]?.focus();
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [pathname]);
}
