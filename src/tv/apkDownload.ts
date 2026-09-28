/**
 * Where the Android TV build is published.
 *
 * The obvious link — the GitHub Actions artifact — is the wrong one. Artifacts
 * require a logged-in session to download and expire on a retention timer
 * (14 days in android-tv.yml), so a link to one works for whoever pushed the
 * commit and for nobody else. A visitor who has never seen this repository
 * would be sent to a login page, and a user who came back a fortnight later
 * would be sent to a 404.
 *
 * Release *assets* are served over plain HTTPS with no authentication, which is
 * what a public download button needs. android-tv.yml therefore publishes the
 * debug APK as an asset of a rolling `apk-latest` prerelease on every push to
 * main, and the tag never moves — so this URL is stable and can be baked into
 * the app.
 *
 * A prerelease rather than a normal release, deliberately: `/releases/latest`
 * skips prereleases, so this rolling tag cannot hijack that path once real
 * `v*` tags start being published by android-release.yml.
 *
 * Two values below are duplicated in .github/workflows/android-tv.yml and have
 * to be changed together: the asset filename and the `apk-latest` tag.
 */

const REPO = 'SachiSagar5/IPTV-Player';

/** Rolling prerelease tag maintained by android-tv.yml. */
const ROLLING_TAG = 'apk-latest';

/** Must match the name the debug workflow gives the APK. */
const APK_NAME = 'IPTV-TV-debug.apk';

/**
 * Direct download for the current Android TV build.
 *
 * Redirects, so this is a stable string rather than a versioned one. The cost
 * is that it cannot be cached by the far end for long, which for a ~10 MB file
 * is not the bottleneck.
 */
export const apkUrl = (): string =>
  `https://github.com/${REPO}/releases/download/${ROLLING_TAG}/${APK_NAME}`;

/** Every published build, for anyone who wants a specific version. */
export const releasesUrl = (): string => `https://github.com/${REPO}/releases`;
