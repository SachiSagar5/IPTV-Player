/**
 * Application entry.
 *
 * Responsibilities, in order:
 *  1. Install the router.
 *  2. Hydrate from IndexedDB *before* the first paint of real content, so the
 *     app never renders against a half-loaded playlist.
 *  3. Ask the browser to keep storage (best-effort; a refusal is fine).
 *
 * `hydrate()` is intentionally awaited inside `bootstrap` rather than fired and
 * forgotten: `BootGate` shows a spinner until it resolves, and starting the
 * first paint earlier would just mean rendering a spinner.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { createRouter } from './routes';
import { hydrate } from '@/store/appStore';
import { onDbBlocked, requestPersistentStorage } from '@/services/storage/db';
import { isNativeHlsSupported } from '@/services/hls/hlsEngine';
import { markPlatform } from '@/tv/platform';
import './index.css';

// Before anything renders, not inside `bootstrap`: the answer decides whether
// the TV stylesheet applies, and a first paint without it would flash the
// desktop metrics at a TV. Capacitor injects its global before any app script
// runs, so this is already correct by the time it executes.
markPlatform();

/** Retire the static `#boot` splash once React has painted. */
function removeBootSplash(): void {
  document.getElementById('boot')?.remove();
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) {
    removeBootSplash();
    throw new Error('#root is missing from index.html');
  }

  // Non-blocking: a blocked upgrade just means another tab holds the old
  // connection, so we let the user keep using the app.
  onDbBlocked(() => {
    console.warn('[db] upgrade blocked by another open tab');
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      const event = new CustomEvent('indexeddb-blocked');
      window.dispatchEvent(event);
    }
  });

  try {
    await hydrate();
    // Fire-and-forget and dynamically imported: the poster and rating caches are
    // optional enhancements, so none of it should sit in the first-paint payload.
    void import('@/store/posterStore')
      .then((m) => m.hydratePosterCache())
      .catch(() => undefined);
    void import('@/store/metaStore')
      .then((m) => m.hydrateMetaCache())
      .catch(() => undefined);
  } catch (error) {
    // `hydrate` records its own failure in the store; this is the last resort.
    console.error('[boot] hydration failed', error);
  }

  // Best-effort: stops the browser evicting cached playlists under pressure.
  void requestPersistentStorage().catch(() => false);

  if (!isNativeHlsSupported()) {
    // Not fatal — hls.js covers every non-Safari browser.
    document.documentElement.dataset.hlsEngine = 'hls.js';
  }

  const root = createRoot(container);
  root.render(
    <StrictMode>
      <RouterProvider router={createRouter()} />
    </StrictMode>,
  );

  // The splash must go only after the first real commit, otherwise it hides an
  // empty #root and the user sees a flash of the splash again.
  requestAnimationFrame(() => requestAnimationFrame(removeBootSplash));
}

void bootstrap().catch((error: unknown) => {
  console.error('[boot] fatal', error);
  removeBootSplash();
  const container = document.getElementById('root');
  if (container) {
    container.textContent = 'The app failed to start. Check the console for details.';
    container.className = 'grid min-h-dvh place-items-center p-6 text-center text-sm text-[#8b93a7]';
  }
});
