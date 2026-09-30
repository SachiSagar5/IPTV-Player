/**
 * Route table.
 *
 * Every page except the player is wrapped in the same `AppLayout` shell, and the
 * player is nested *inside* it so the boot gate still applies (a player opened
 * cold must wait for hydration) while the shell hides its own chrome there.
 *
 * Paths are declared once, in `utils/routes`, and reused by the nav, the cards
 * and the links, so a route can never drift from what the UI advertises.
 */
import { lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ROUTES } from '@/utils/routes';

const HomePage = lazy(() => import('@/pages/Home/HomePage'));
const LiveTvPage = lazy(() => import('@/pages/LiveTV/LiveTvPage'));
const MoviesPage = lazy(() => import('@/pages/Movies/MoviesPage'));
const SeriesPage = lazy(() => import('@/pages/Series/SeriesPage'));
const SeriesDetailPage = lazy(() => import('@/pages/Series/SeriesDetailPage'));
const SearchPage = lazy(() => import('@/pages/Search/SearchPage'));
const MyListPage = lazy(() => import('@/pages/MyList/MyListPage'));
const PlaylistsPage = lazy(() => import('@/pages/Playlists/PlaylistsPage'));
const SettingsPage = lazy(() => import('@/pages/Settings/SettingsPage'));
const PlayerPage = lazy(() => import('@/pages/Player/PlayerPage'));
const AdultPage = lazy(() => import('@/pages/Adult/AdultPage'));
const TraktCallback = lazy(() => import('@/pages/Auth/TraktCallback'));

/**
 * The Parent route is derived from `ROUTES` rather than written as a literal.
 * It is the one path here that a rename would silently break: an unmatched path
 * does not 404, it falls through the `*` catch-all to the Home page, so a stale
 * literal looks like a working app on the wrong screen.
 */
const PARENT_PATH = ROUTES.adult.replace(/^\//, '');

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'live', element: <LiveTvPage /> },
      { path: 'movies', element: <MoviesPage /> },
      { path: 'series', element: <SeriesPage /> },
      { path: 'series/:seriesId', element: <SeriesDetailPage /> },
      { path: 'my-list', element: <MyListPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'playlists', element: <PlaylistsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: PARENT_PATH, element: <AdultPage /> },
      { path: 'auth/trakt/callback', element: <TraktCallback /> },
      // Player routes keep the shell but drop the nav chrome (see AppLayout).
      { path: 'watch/:contentId', element: <PlayerPage /> },
      { path: 'watch/series/:seriesId', element: <PlayerPage /> },
      // Deep links from notifications / a PWA shortcut land here.
      { path: '*', element: <HomePage /> },
    ],
  },
];

/**
 * Built by `main.tsx` rather than at import time. A module-scope
 * `createBrowserRouter` reads `window.history` as an import side effect, which
 * breaks any non-browser consumer of this module (tests, SSR, a future
 * pre-render) before a single line of app code has run.
 */
export function createRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(routes);
}
