/**
 * Top navigation bar and the compact playlist switcher.
 *
 * The bar is intentionally minimal on scroll (transparent → solid, no height
 * animation) because animating layout on scroll is the single easiest way to
 * make a long browse page feel janky.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ROUTES } from '@/utils/routes';
import { Icon } from '@/components/common/Icon';
import type { IconName } from '@/components/common/Icon';
import { IconButton } from '@/components/common/Button';
import { PlaylistSwitcher } from './PlaylistSwitcher';
import { aggregateCounts, useAppSelector } from '@/store/appStore';
import { formatCount } from '@/utils/format';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Hidden from the desktop bar when the playlist has no such content. */
  requiresContent?: boolean;
  /**
   * Gated behind the parental PIN: hidden unless parental controls are on *and*
   * there is gated content to show.
   */
  requiresParentControls?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: ROUTES.home, label: 'Home', icon: 'home' },
  { to: ROUTES.live, label: 'Live TV', icon: 'tv', requiresContent: true },
  { to: ROUTES.movies, label: 'Movies', icon: 'film', requiresContent: true },
  { to: ROUTES.series, label: 'Series', icon: 'layers', requiresContent: true },
  { to: ROUTES.myList, label: 'My List', icon: 'list' },
  { to: ROUTES.search, label: 'Search', icon: 'search' },
  { to: ROUTES.playlists, label: 'Playlists', icon: 'playlist' },
  { to: ROUTES.settings, label: 'Settings', icon: 'settings' },
  {
    to: ROUTES.adult,
    label: 'Parent',
    icon: 'lock',
    requiresParentControls: true,
  },
];

/** Routes shown in the mobile bar: Home, Live, Movies, Search, Playlists. */
const MOBILE_TABS: readonly string[] = [
  ROUTES.home,
  ROUTES.live,
  ROUTES.movies,
  ROUTES.search,
  ROUTES.playlists,
];

export const TopNav = memo(function TopNav() {
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const playlists = useAppSelector((s) => s.playlists);
  const parentControls = useAppSelector((s) => s.settings.parentControls);
  const parentPlaylistIds = useAppSelector((s) => s.parentPlaylistIds);

  useEffect(() => {
    let frame = 0;
    const onScroll = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrolled(window.scrollY > 24);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const isWatchRoute = location.pathname.startsWith('/watch');
  // Aggregate across playlists so a category is not hidden just because the
  // playlist you happen to be viewing happens to lack it.
  const counts = useMemo(() => aggregateCounts(playlists), [playlists]);
  // Tally from every saved playlist, matching how the other tabs are counted: a
  // category should not disappear just because the playlist in view lacks it.
  // Adult entries in *every* reserved playlist do not count, because none of
  // those playlists is part of ordinary browsing. Keyed off the whole reserved
  // set rather than the one on show, so a second gated list cannot inflate the
  // ordinary tally with entries nobody can reach.
  const gated = useMemo(() => new Set(parentPlaylistIds), [parentPlaylistIds]);
  const adultCount = useMemo(
    () =>
      playlists.reduce(
        (total, p) => (gated.has(p.id) ? total : total + (p.adultCount ?? 0)),
        0,
      ),
    [playlists, gated],
  );
  // Any reserved playlist is enough to make the tab worth showing, including when
  // the one on show failed to load and left `parentPlaylistId` null.
  const parentHasContent = useMemo(
    () => parentPlaylistIds.length > 0 || adultCount > 0,
    [parentPlaylistIds, adultCount],
  );

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.requiresParentControls) return parentControls && parentHasContent;
    if (!item.requiresContent) return true;
    if (item.to === ROUTES.live) return counts.live > 0;
    if (item.to === ROUTES.movies) return counts.movie > 0;
    if (item.to === ROUTES.series) return counts.series > 0;
    return true;
  });

  // The mobile bar picks a fixed subset of tabs, and only gains the Parent one when
  // it is actually available: a six-tab bar on a phone is tight, and no one
  // should pay for a tab they cannot use.
  const mobileTabs = useMemo(() => {
    const base = NAV_ITEMS.filter((item) => MOBILE_TABS.includes(item.to));
    const adultTab = NAV_ITEMS.find((item) => item.to === ROUTES.adult);
    return adultTab && parentControls && parentHasContent ? [...base, adultTab] : base;
  }, [parentControls, parentHasContent]);

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${
          scrolled || isWatchRoute
            ? 'surface-glass'
            : 'bg-gradient-to-b from-black/85 via-black/45 to-transparent'
        }`}
      >
        <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-2 px-3 md:h-16 md:gap-5 md:px-6">
          <Link
            to={ROUTES.home}
            className="group flex shrink-0 items-center gap-2.5 rounded px-1 py-1"
            aria-label="IPTV Player — home"
          >
            <span className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-accent-300 to-accent-500 text-ink-1000 shadow-glow transition-transform duration-300 ease-present group-hover:scale-105">
              <Icon name="play" size={15} filled />
              {/* Sheen sweep across the mark: the brand element is the one thing
                  on every screen, so it gets the motion budget. */}
              <span className="sheen absolute inset-0" aria-hidden="true" />
            </span>
            <span className="hidden text-[15px] font-bold tracking-tight text-mist-50 sm:inline">
              <span className="text-accent-gradient">IPTV</span>
              <span className="ml-1.5 text-mist-400">Player</span>
            </span>
          </Link>

          <nav
            aria-label="Primary"
            className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:flex"
          >
            {visibleItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === ROUTES.home}
                data-nav
                className={({ isActive }) =>
                  `group/nav relative rounded-full px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-200 ${
                    isActive
                      ? 'bg-accent-500/12 text-mist-50 shadow-[inset_0_0_0_1px_rgb(var(--accent-400-rgb)/0.3)]'
                      : 'text-mist-400 hover:bg-ink-800/70 hover:text-mist-50'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {item.label}
                    {isActive ? (
                      <span className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-gradient-to-r from-accent-400 to-accent-200 shadow-[0_0_10px_rgb(var(--accent-400-rgb)/0.6)]" />
                    ) : null}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <IconButton
              icon="search"
              label="Search"
              size="sm"
              onClick={() => navigate(ROUTES.search)}
            />
            <PlaylistSwitcher />
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar. Larger tap targets, thumb-reachable. */}
      <nav
        aria-label="Primary mobile"
        className="surface-glass fixed inset-x-0 bottom-0 z-40 lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div
          className={`mx-auto grid max-w-md ${mobileTabs.length === 6 ? 'grid-cols-6' : 'grid-cols-5'}`}
        >
          {mobileTabs.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === ROUTES.home}
              className={({ isActive }) =>
                `relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
                  isActive ? 'text-accent-300' : 'text-mist-500'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`flex h-7 w-11 items-center justify-center rounded-full transition-colors duration-200 ${
                      isActive ? 'bg-accent-500/15' : ''
                    }`}
                  >
                    <Icon name={item.icon} size={19} filled={isActive} />
                  </span>
                  {item.label}
                  {isActive ? (
                    <span className="absolute top-0 h-0.5 w-6 rounded-full bg-accent-400" />
                  ) : null}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
});

/** Compact stat strip shown on Playlists, used by Settings too. */
export function PlaylistSummary({ itemCount }: { itemCount: number }) {
  return <span className="tabular-nums">{formatCount(itemCount)} items</span>;
}
