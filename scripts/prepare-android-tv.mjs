#!/usr/bin/env node
/**
 * Turn the stock `cap add android` scaffold into an Android TV app.
 *
 * ## Why this is a script and not a committed `android/` directory
 *
 * The Gradle wrapper JAR is a binary. It cannot be reviewed in a diff, and
 * committing it means nobody needs the Android SDK, a JDK, Gradle or the
 * Capacitor CLI installed locally — the whole native build happens in GitHub
 * Actions. The cost is that the native project is not reviewable in a pull
 * request, so this file is the reviewable description of it: every change to
 * the shipped Android project is made here, in text, in the same commit.
 *
 * ## Order
 *
 * Run this *after* `cap add android` and `cap sync android`, never before.
 * `cap sync` rewrites `app/capacitor.build.gradle` and touches `app/build.gradle`,
 * so anything applied beforehand can be silently reverted. The script asserts
 * that sync has already run rather than trusting the workflow to order things.
 *
 * ## Idempotence
 *
 * The manifest, banner, colours and styles are written wholesale rather than
 * patched in place, and the Gradle edit is anchored on a marker comment that is
 * removed once written. Running the script twice is a no-op, which means a
 * re-run after a partial failure converges instead of corrupting the project.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = join(ROOT, 'android');
const APP = join(ANDROID, 'app');
const MAIN = join(APP, 'src', 'main');
const RES = join(MAIN, 'res');

/** Read the app id / name from `capacitor.config.ts` without importing it. */
function readCapacitorConfig() {
  const source = readFileSync(join(ROOT, 'capacitor.config.ts'), 'utf8');
  const appId = source.match(/appId:\s*'([^']+)'/)?.[1];
  const appName = source.match(/appName:\s*'([^']+)'/)?.[1];
  if (!appId || !appName) {
    throw new Error('Could not read appId/appName from capacitor.config.ts');
  }
  return { appId, appName };
}

const { appId, appName } = readCapacitorConfig();

function mustExist(path, why) {
  if (!existsSync(path)) {
    throw new Error(
      `Expected ${path.replace(ROOT + '/', '')} to exist (${why}). ` +
        'Either `cap add android` / `cap sync android` did not run, or the ' +
        'Capacitor template changed shape and this script needs updating.',
    );
  }
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
  console.log(`  wrote  ${path.replace(ROOT + '/', '')}`);
}

// Proves `cap sync` ran, and therefore that nothing will overwrite our work.
mustExist(join(APP, 'capacitor.build.gradle'), 'written by `cap sync android`');

// ---------------------------------------------------------------------------
// 1. AndroidManifest.xml
// ---------------------------------------------------------------------------
/**
 * Written in full rather than edited, because the changes are all
 * structural — new `<uses-feature>` elements, a second launcher category, extra
 * attributes on `<application>` — and every one of them is a targeted edit
 * against a template that has no comments saying where it may safely change.
 *
 * `leanback required="false"` plus `touchscreen required="false"` is the
 * combination that makes one build installable on Android TV, Google TV and
 * Fire TV *and* still sideload onto a phone or tablet. Marking leanback
 * required would hide the app from every non-TV device, which is not what this
 * project wants.
 */
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <!--
        Two capabilities, both optional.

        leanback is the Android TV launcher interface; a device without it simply
        will not show the leanback launcher entry, so this must not be required.
        touchscreen is the paired concession: TVs have no touchscreen, and marking
        it required would make the app uninstallable on the devices it is for.
    -->
    <uses-feature android:name="android.software.leanback" android:required="false" />
    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />

    <!--
        The whole app is: fetch an M3U over HTTP, and play an HLS stream.
        Nothing else is declared on purpose — no storage, no location, no camera,
        no microphone, no Play Services. \`ACCESS_NETWORK_STATE\` is here because
        the player reports a channel as failing when the device is offline, which
        is a different and more useful message than a decode error.
    -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:allowBackup="false"
        android:hardwareAccelerated="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme.NoActionBarLaunch"
        android:banner="@drawable/tv_banner"
        android:usesCleartextTraffic="true">

        <!--
            \`configChanges\` is inherited from the Capacitor template and is
            already comprehensive — every orientation, density and UI-mode change
            is handled in-process. That matters on a TV, where a settings change
            or a resolution switch would otherwise destroy and recreate the
            Activity, tearing down playback and the IndexedDB connection with it.

            \`screenOrientation\` is the one addition: a TV app is landscape, and
            allowing portrait would letterbox the player for no reason.
        -->
        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTask"
            android:screenOrientation="sensorLandscape"
            android:theme="@style/AppTheme.NoActionBarLaunch">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <!-- Phones and tablets. -->
                <category android:name="android.intent.category.LAUNCHER" />
                <!-- Android TV / Google TV / Fire TV home row. -->
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>

        </activity>

        <!-- Required by Capacitor for camera/file uploads, unused by this app. -->
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="\${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths"></meta-data>
        </provider>
    </application>
</manifest>
`;

console.log('\nPreparing the Android TV project');
write(join(MAIN, 'AndroidManifest.xml'), manifest);

// ---------------------------------------------------------------------------
// 2. TV banner
// ---------------------------------------------------------------------------
/**
 * The banner is the wide card an Android TV launcher shows for an app, and it
 * is mandatory — without it the app is installable but has no TV home-row
 * entry on most launchers.
 *
 * A vector rather than a PNG, deliberately: it stays reviewable in this file,
 * scales to any launcher density with no per-bucket binaries, and needs no image
 * library at build time. 320x180 is the reference size every TV launcher is
 * designed around.
 */
write(
  join(RES, 'drawable', 'tv_banner.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<!-- 320x180 reference, the aspect every Android TV launcher lays its app row out for. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="320dp"
    android:height="180dp"
    android:viewportWidth="320"
    android:viewportHeight="180">
    <path
        android:pathData="M0,0h320v180h-320z"
        android:fillColor="#0E0A1F" />
    <path
        android:pathData="M0,0h320v180h-320z">
        <aapt:attr xmlns:aapt="http://schemas.android.com/aapt" name="android:fillColor">
            <gradient
                android:startX="0"
                android:startY="0"
                android:endX="320"
                android:endY="180"
                android:type="linear">
                <item android:offset="0" android:color="#DDD6FE" />
                <item android:offset="1" android:color="#6D28D9" />
            </gradient>
        </aapt:attr>
    </path>
    <!-- The play mark from the web app's own logo. -->
    <path
        android:pathData="M136,64 L136,116 L182,90 Z"
        android:fillColor="#08090C" />
    <path
        android:pathData="M196,66h10v48h-10z M210,78h10v36h-10z M224,90h10v24h-10z"
        android:fillColor="#08090C"
        android:fillAlpha="0.55" />
</vector>
`,
);

// ---------------------------------------------------------------------------
// 3. Theme
// ---------------------------------------------------------------------------
/**
 * The theme is what puts the app edge-to-edge on a TV. `windowFullscreen`
 * removes the status bar, and the display-cutout mode lets the player's black
 * bars reach the panel edge on a set with a bezel-less design.
 *
 * Both are appended to the styles the Capacitor template already defines rather
 * than replacing the file, so a template upgrade keeps the app's own theme
 * chain intact.
 */
const stylesPath = join(RES, 'values', 'styles.xml');
const styles = readFileSync(stylesPath, 'utf8');
if (styles.includes('TV_THEME_ITEMS')) {
  console.log('  skip  styles.xml (already patched)');
} else {
  write(
    stylesPath,
    styles.replace(
      '</resources>',
      `
    <!-- TV_THEME_ITEMS -->
    <style name="AppTheme.Tv" parent="AppTheme.NoActionBar">
        <!-- No status bar: a TV has no clock, battery or notifications, and the
             space is better spent on the video. -->
        <item name="android:windowFullscreen">true</item>
        <item name="android:windowContentOverlay">@null</item>
        <!-- #08090C is the app background token from src/index.css (ink-950).
             Matching it means the launch and the first painted frame are the
             same colour, so there is no white flash before React mounts. -->
        <item name="android:windowBackground">@color/tv_background</item>
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
    </style>

    <style name="AppTheme.Tv.Launch" parent="Theme.SplashScreen">
        <item name="android:windowFullscreen">true</item>
        <item name="android:windowBackground">@drawable/splash</item>
        <item name="postSplashScreenTheme">@style/AppTheme.Tv</item>
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
    </style>
</resources>`,
    ),
  );
}

write(
  join(RES, 'values', 'colors.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Mirrors the ink-950 background token in src/index.css. -->
    <color name="tv_background">#08090C</color>
</resources>
`,
);

// Point the activity theme at the TV variant. Done by replacing the theme
// reference in the manifest we just wrote, rather than in styles.xml, so that a
// future Capacitor template cannot silently re-point it.
const manifestPath = join(MAIN, 'AndroidManifest.xml');
write(
  manifestPath,
  readFileSync(manifestPath, 'utf8').replace(
    /android:theme="@style\/AppTheme\.NoActionBarLaunch"/g,
    'android:theme="@style/AppTheme.Tv.Launch"',
  ),
);

// ---------------------------------------------------------------------------
// 4. Release signing
// ---------------------------------------------------------------------------
/**
 * Signing is wired to environment variables rather than a `keystore.properties`
 * file, because the alternative is a file on disk holding a key password. The
 * release workflow supplies the four values from repository secrets and never
 * writes them to the repository.
 *
 * When the variables are absent the release build is left unsigned rather than
 * falling back to the debug key. A debug-signed "release" APK that looks
 * official is a worse failure than a build that plainly is not signed.
 */
const gradlePath = join(APP, 'build.gradle');
let gradle = readFileSync(gradlePath, 'utf8');

if (gradle.includes('// TV_SIGNING')) {
  console.log('  skip  app/build.gradle (signing already patched)');
} else {
  const signingBlock = `
    // TV_SIGNING
    signingConfigs {
        release {
            def storePath = System.getenv('KEYSTORE')
            // Every value or nothing: a half-configured keystore fails deep
            // inside the packaging step with an unhelpful message.
            if (storePath && System.getenv('KEYSTORE_PASSWORD') && System.getenv('KEY_ALIAS') && System.getenv('KEY_PASSWORD')) {
                storeFile file(storePath)
                storePassword System.getenv('KEYSTORE_PASSWORD')
                keyAlias System.getenv('KEY_ALIAS')
                keyPassword System.getenv('KEY_PASSWORD')
            }
        }
    }
`;
  // The signingConfigs block has to be a sibling of `buildTypes`, so it is
  // inserted just before it.
  gradle = gradle.replace(/\n    buildTypes \{/, `${signingBlock}\n    buildTypes {`);

  gradle = gradle.replace(
    /        release \{\n            minifyEnabled false/,
    '        release {\n            signingConfig signingConfigs.release\n            minifyEnabled false',
  );

  // `cap sync` writes the namespace/applicationId from capacitor.config.ts,
  // but assert it anyway: a wrong applicationId is an un-updatable app.
  if (!gradle.includes(`applicationId "${appId}"`)) {
    throw new Error(
      `app/build.gradle does not declare applicationId "${appId}". ` +
        'Refusing to guess — check that `cap add android` read capacitor.config.ts.',
    );
  }

  write(gradlePath, gradle);
}

// ---------------------------------------------------------------------------
// 5. Launcher icons
// ---------------------------------------------------------------------------
/**
 * The template ships a stock teal placeholder. The web app already has real
 * icons, so those are copied in — the same 512px artwork is used at every
 * density and the launcher scales it down. That is not as crisp as true
 * per-density assets, but it is correct branding everywhere, and adding an
 * image resizer to the build for a soft edge on a 48px icon is not a trade
 * worth making.
 */
const iconSource = join(ROOT, 'public', 'icons', 'icon-512.png');
if (!existsSync(iconSource)) {
  console.log('  skip  launcher icons (public/icons/icon-512.png not found)');
} else {
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    const dir = join(RES, `mipmap-${density}`);
    mkdirSync(dir, { recursive: true });
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      copyFileSync(iconSource, join(dir, name));
    }
  }
  console.log('  copy  launcher icons (5 densities)');
}

// The adaptive-icon background is a flat colour behind that artwork, so it is
// retinted to the app's own dark surface rather than the template's white.
write(
  join(RES, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#08090C</color>
</resources>
`,
);

console.log(`\nAndroid TV project ready: ${appName} (${appId})\n`);
