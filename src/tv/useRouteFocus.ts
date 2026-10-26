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
 * navigable element in the page content.
 *
 * The landing cannot be a single attempt after two frames. Every page is a
 * lazily imported chunk, and the grid inside it only exists once that chunk has
 * downloaded, parsed and rendered — well after the route changed. The earlier
 * version fired both attempts while `#main` still held the Suspense fallback,
 * found no candidates, and gave up, which is exactly the reported bug: the
 * browse screens opened with focus on `<body>` and the remote was dead. The
 * boot gate has the same shape of race: `#main` does not exist at all until
 * hydration finishes.
 *
 * So the landing now waits for the content instead of guessing at a delay: a
 * MutationObserver watches the document and lands focus the first time a
 * navigable control exists. It stops as soon as focus is decided — by us, by
 * the user, or by a dialog — or after a short deadline, whichever comes first.
 *
 * Native only: the browser already does something equivalent for keyboard
 * users and its own heuristics are fine, so the web build is left untouched.
 */
const LANDING_DEADLINE_MS = 5000;

export function useRouteFocus(): void {
  const { pathname } = useLocation();

  useEffect(() => {
    if (!isNativeShell()) return;
    // The player owns its own focus (the video element is `tabindex="-1"` and
    // the control bar is a separate D-pad container) and has no landing card.
    if (pathname.startsWith('/watch')) return;
    // A dialog opened on top of the new route already decides where focus goes.
    if (document.querySelector('dialog[open]')) return;

    let observer: MutationObserver | null = null;
    let frame = 0;
    let deadline = 0;
    let settled = false;

    const settle = (): void => {
      settled = true;
      observer?.disconnect();
      observer = null;
      window.clearTimeout(deadline);
      if (frame) cancelAnimationFrame(frame);
    };

    /** Returns true when no further attempt can help. */
    const attempt = (): boolean => {
      if (settled) return true;

      const main = document.getElementById('main');
      // Still behind the boot gate: there is no page to land on yet.
      if (!main) return false;

      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body) {
        // Someone else already owns focus: the user moved into the page, or
        // deliberately stayed in the chrome (the header nav keeps focus across
        // a route change, and Down from there steps into the page).
        return true;
      }

      // Shared with the D-pad hook, so the landing element is always one the
      // arrow keys can actually reach from.
      const first = navCandidates(main)[0];
      if (!first) return false;

      first.focus();
      return document.activeElement === first;
    };

    const run = (): void => {
      if (settled) return;
      if (attempt()) settle();
    };

    // Two frames: one for React to commit, one for the row's
    // `IntersectionObserver` to have mounted whatever it renders eagerly.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(run);
    });

    // …then keep watching for the lazy chunk / hydration that the frames above
    // can easily beat on a TV box.
    observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });

    deadline = window.setTimeout(() => {
      // Content never appeared (an empty playlist, a failing chunk). Nothing
      // left to focus, so stop burning a mutation observer on every frame.
      settle();
    }, LANDING_DEADLINE_MS);

    return settle;
  }, [pathname]);
}
