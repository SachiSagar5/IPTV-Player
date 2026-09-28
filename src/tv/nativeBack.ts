/**
 * Android hardware Back.
 *
 * In a browser, Back is the browser's problem. In the native shell it is ours:
 * registering a `backButton` listener takes the button over completely, and
 * Capacitor will no longer close the Activity on its own. If we get that wrong
 * the app becomes a one-screen trap — Back does nothing and the user has to
 * force-close it.
 *
 * So Back is resolved in strict order of specificity, and only exits as a last
 * resort:
 *
 *   1. The topmost open `<dialog>` closes. Every modal in the app is a native
 *      `<dialog>` (see `Modal.tsx`), so this needs no dialog registry — and it
 *      means an unsaved form or a confirmation is always dismissed before
 *      anything behind it.
 *   2. Otherwise the router goes back one entry.
 *   3. Otherwise, and only at the root of the stack, the app closes.
 *
 * Modals deliberately win over history. A user who opens the "delete playlist"
 * confirmation and presses Back means "never mind", not "go to the page I was
 * on before the confirmation".
 */
import { isNativeShell } from './platform';

type PluginListener = { remove: () => Promise<void> };
type BackButtonListener = { canGoBack: () => boolean };
type AppStateListener = { isActive: boolean };

interface AppPlugin {
  addListener(
    event: 'backButton',
    handler: (arg: BackButtonListener) => void,
  ): Promise<PluginListener>;
  addListener(
    event: 'appStateChange',
    handler: (arg: AppStateListener) => void,
  ): Promise<PluginListener>;
  exitApp(): void;
  minimizeApp?(): void;
}

/** The topmost open dialog, or null. `querySelectorAll` is in document order. */
function topmostDialog(): HTMLDialogElement | null {
  const open = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  return open.length > 0 ? open[open.length - 1] : null;
}

async function loadAppPlugin(): Promise<AppPlugin | null> {
  try {
    const mod = await import('@capacitor/app');
    return mod.App as unknown as AppPlugin;
  } catch {
    return null;
  }
}

/**
 * Install the handler. Returns a teardown function; on web it is a no-op that
 * costs one `isNativeShell()` call and one failed-free early return.
 */
export function installNativeBack(navigate: (delta: number) => void): () => void {
  if (!isNativeShell()) return () => undefined;

  let disposed = false;
  const teardown: Array<() => Promise<void>> = [];

  void (async () => {
    const App = await loadAppPlugin();
    // A missing plugin means this is a Capacitor build without the App plugin;
    // without a listener the platform's own Back behaviour still applies, so
    // the app stays usable rather than trapping the user.
    if (!App || disposed) return;

    const back = await App.addListener('backButton', ({ canGoBack }) => {
      const dialog = topmostDialog();
      if (dialog) {
        // `close()` fires the dialog's `close` event, which `Modal` already
        // treats as a close request, so React state stays in sync.
        dialog.close();
        return;
      }
      if (canGoBack()) {
        navigate(-1);
        return;
      }
      App.exitApp();
    });
    teardown.push(() => back.remove());

    const state = await App.addListener('appStateChange', ({ isActive }) => {
      // Backgrounding on a TV happens when the user opens another app, and
      // decoding audio for an invisible player is a battery cost with no
      // upside. `VideoPlayer` listens for `visibilitychange` too; this covers
      // the case where the WebView itself was never told the page was hidden.
      if (!isActive) document.dispatchEvent(new Event('visibilitychange'));
    });
    teardown.push(() => state.remove());
  })();

  return () => {
    disposed = true;
    for (const remove of teardown) void remove();
  };
}
