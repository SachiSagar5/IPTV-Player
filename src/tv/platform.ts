/**
 * Which shell is this running in?
 *
 * The app ships as one codebase for two very different input models. In a
 * browser the pointer is the primary device and a keyboard is a convenience. In
 * the Android TV / Google TV / Fire TV build there is no pointer at all: the
 * D-pad is the only way to move and the remote's OK button is the only way to
 * act. Several things genuinely have to differ between the two — how Back
 * behaves, how large the focus ring is, whether the expensive ambient blur
 * animations run at all.
 *
 * Detection deliberately does not sniff the user agent. Android TV, Google TV
 * and Fire TV all report an ordinary mobile Chrome UA, and plenty of browsers
 * run on TV boxes. Instead this asks the native shell directly: Capacitor
 * injects `window.Capacitor` before any application script runs, so the answer
 * is known synchronously at startup and there is no render-then-correct flash.
 *
 * `import('@capacitor/app')` is dynamic and guarded, so a browser build never
 * pulls the plugin in at all — the web bundle contains no Capacitor code.
 */

/** The `android` bridge; only present in the native shell. */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
}

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True in the Android TV / Google TV / Fire TV build. */
export const isNativeShell = (): boolean => {
  const cap = capacitor();
  return typeof cap?.isNativePlatform === 'function' ? cap.isNativePlatform() : false;
};

/** The native platform id, e.g. `android`. */
export const nativePlatform = (): string => capacitor()?.getPlatform?.() ?? 'web';

/**
 * Mark the document so CSS can style the TV build without a second class
 * hierarchy. `[data-tv]` is the single gate for the 10-foot treatment:
 * larger focus ring, heavier type, and the expensive ambient effects off.
 */
export function markPlatform(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.platform = nativePlatform();
  if (isNativeShell()) root.dataset.tv = 'true';
}
