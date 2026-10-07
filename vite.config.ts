import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/**
 * Are we building the native Android TV bundle?
 *
 * The web and native builds come from the same source but not the same output.
 * In a WebView the bundle is served from a local origin and the app is already
 * on the device, so a service worker has nothing to do but occupy space: it
 * precaches a shell that cannot go stale, and it competes with the app's own
 * IndexedDB poster cache. `vite-plugin-pwa` is therefore dropped for the native
 * target, which also keeps `sw.js` and the Workbox runtime (~5 kB) out of the
 * APK entirely.
 *
 * `injectRegister: null` below means the web build also never registers a
 * service worker — the plugin emits the files but the app opts out. That is the
 * pre-existing behaviour and this does not change it.
 */
const isNativeBuild = process.env.CAPACITOR_BUILD === 'true';

/**
 * PWA plugin, dropped for the native bundle. See the note above.
 */
const pwaPlugins = isNativeBuild
  ? []
  : [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'IPTV Player',
        short_name: 'IPTV',
        description:
          'Fast IPTV playlist manager and HLS player with a cinematic streaming interface.',
        theme_color: '#08090c',
        background_color: '#08090c',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        categories: ['entertainment', 'video', 'multimedia'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell precache. Playlists/streams are NEVER cached by the SW.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // Playlist XML/M3U documents: network first with a small cache.
            urlPattern: ({ url }: { url: URL }) => url.pathname.endsWith('.m3u'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'iptv-playlists',
              networkTimeoutSeconds: 20,
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 6 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Channel logos / artwork.
            urlPattern: ({ request }: { request: Request }) =>
              request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'iptv-artwork',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ];

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/IPTV-Player/' : './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    ...pwaPlugins,
  ],
  server: {
    proxy: {
      '/api/stream': {
        target: 'https://iptvplayer-ebon.vercel.app',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/stream/, '/api/stream'),
      },
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    assetsInlineLimit: 2048,
    reportCompressedSize: false,
    // `vendor-hls` is ~590 kB raw and is the single largest chunk, but it is
    // behind a dynamic import in `hlsEngine` and is not in the initial HTML, so
    // it is only paid for by someone who actually opens a stream. The default
    // 500 kB warning would otherwise fire on every build for no reason.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Only the four dependencies worth pinning get their own chunk. Anything
        // else is left to Rollup: a catch-all bucket here used to emit an empty
        // chunk for the handful of modules left over.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('hls.js')) return 'vendor-hls';
          if (id.includes('react-router')) return 'vendor-router';
          if (id.includes('@tanstack')) return 'vendor-virtual';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('scheduler')) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
});
