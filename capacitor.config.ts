/**
 * Capacitor configuration for the Android TV / Google TV / Fire TV build.
 *
 * The `android/` project is deliberately *not* committed. GitHub Actions runs
 * `cap add android` and then `scripts/prepare-android-tv.mjs`, which turns the
 * stock scaffold into a leanback TV app. The reason is that the Gradle wrapper
 * JAR is a binary that cannot be reviewed in a diff, and generating it means
 * nobody needs the Android SDK, a JDK, Gradle, or the Capacitor CLI installed
 * locally. The trade-off is that the native project is not reviewable in a pull
 * request, so `prepare-android-tv.mjs` is written to tell the whole story.
 *
 * Typed structurally rather than by importing `CapacitorConfig` from
 * `@capacitor/cli`, because the CLI is a build-time-only dependency and is not
 * installed for local web development. The shape below is the subset of the
 * schema this project uses; `npx cap` validates it in CI.
 */
export interface AppConfig {
  appId: string;
  appName: string;
  webDir: string;
  android: {
    /** Permit `http://` subresources from the `https://localhost` origin. */
    allowMixedContent: boolean;
  };
  server: {
    androidScheme: string;
  };
}

const config: AppConfig = {
  // The package name on the device, the key in the Play listing, and the
  // identity every future update must match. Changing it after release ships a
  // different app to every existing user, so it is effectively permanent.
  appId: 'com.sachin.iptvplayer',
  appName: 'IPTV Player',
  // Matches Vite's default `outDir`. `base: './'` in `vite.config.ts` is what
  // makes that output load correctly from the WebView's local origin.
  webDir: 'dist',
  android: {
    /**
     * The app is a local-first playlist player: it talks to whatever provider
     * URLs the user supplies, and a large share of IPTV endpoints are plain
     * `http://`. The WebView is served over `https://localhost`, so without
     * this every one of them is blocked as mixed content and no channel plays.
     *
     * This is a native-only relaxation of the same restriction the web build
     * lives with, and it does not weaken the deployed site: HTTPS is still
     * preferred for anything that offers it.
     */
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
