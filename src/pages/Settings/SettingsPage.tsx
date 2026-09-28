/**
 * Settings.
 *
 * Preferences are grouped by what they affect, and every one of them is
 * immediately applied and persisted — there is no Save button, because a
 * setting that needs confirming is a setting the user does not trust.
 *
 * Preferences live in LocalStorage (tiny, synchronous) while playlists and
 * progress live in IndexedDB; the "reset" actions are separated by that
 * boundary so nobody accidentally wipes 200 MB of cached playlist by clearing
 * watch progress.
 */
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PageHeader, PageEnd } from '@/components/layout/PageHeader';
import { Switch, SegmentedControl } from '@/components/common/Form';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { InlineBanner } from '@/components/common/States';
import { Icon } from '@/components/common/Icon';
import { useDpadNavigation } from '@/hooks/useDpadNavigation';
import { activatePlaylist, updateSettings, useAppSelector } from '@/store/appStore';
import { wipeUserData } from '@/services/storage/userDataRepo';
import { playlistsRepo } from '@/services/storage/playlistRepo';
import {
  clearRecentSearches,
  loadAdultPinHash,
  saveAdultPinHash,
} from '@/services/storage/prefs';
import { hashPin, validatePin } from '@/utils/pin';
import { lockAdult } from '@/store/adultGate';

export default function SettingsPage() {
  const settings = useAppSelector((s) => s.settings);
  const playlists = useAppSelector((s) => s.playlists);
  const activeId = useAppSelector((s) => s.activePlaylistId);
  const favorites = useAppSelector((s) => s.favorites);
  const progressCount = useAppSelector((s) => s.progressById.size);
  const itemCount = useAppSelector((s) => s.items.length);
  const rootRef = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState<'progress' | 'cache' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pinEditorOpen, setPinEditorOpen] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [newPinConfirm, setNewPinConfirm] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  // Whether a PIN of the parent's own choosing has replaced the default. Read from
  // storage rather than kept as state so it stays correct across reloads.
  const [customPin, setCustomPin] = useState(() => Boolean(loadAdultPinHash()));

  useDpadNavigation(rootRef, { loop: false });

  const run = useCallback(
    async (kind: 'progress' | 'cache', close: () => void) => {
      close();
      if (kind === 'progress') {
        await wipeUserData();
        clearRecentSearches();
        setNotice('Watch progress, favourites and recent searches cleared.');
        return;
      }
      // Clear cached entries but keep each playlist record and its URL, so the
      // list still shows and can be re-downloaded with one tap.
      for (const playlist of playlists) {
        await playlistsRepo.clearItems(playlist.id);
      }
      if (activeId) await activatePlaylist(null);
      setNotice(
        playlists.length === 1
          ? 'Cached entries cleared. Refresh the playlist to download it again.'
          : `Cached entries cleared for ${playlists.length} playlists. Refresh one to download it again.`,
      );
    },
    [playlists, activeId],
  );

  return (
    <div ref={rootRef}>
      <PageHeader title="Settings" subtitle="Everything is stored on this device" />

      {notice ? (
        <div className="px-4 pb-4 md:px-8">
          <InlineBanner tone="success" message={notice} onDismiss={() => setNotice(null)} />
        </div>
      ) : null}

      <Section title="Playback" description="Applied the next time you start playback.">
        <div className="divide-y divide-ink-700">
          <Row>
            <Switch
              label="Autoplay the next episode"
              description="Advance to the following episode when one finishes."
              checked={settings.defaultAutoPlay}
              onCheckedChange={(value) => updateSettings({ defaultAutoPlay: value })}
            />
          </Row>
          <Row>
            <SettingRow
              label="Default quality"
              description="Auto follows the stream and adapts to available bandwidth."
              control={
                <SegmentedControl
                  ariaLabel="Default quality"
                  size="sm"
                  value={settings.defaultQuality}
                  onChange={(value) => updateSettings({ defaultQuality: value })}
                  options={[
                    { value: -1, label: 'Auto' },
                    { value: 0, label: 'Low' },
                    { value: 1, label: 'Mid' },
                    { value: 2, label: 'High' },
                  ]}
                />
              }
            />
          </Row>
          <Row>
            <SettingRow
              label="Default volume"
              description={`${Math.round(settings.defaultVolume * 100)}%`}
              control={
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.defaultVolume}
                  onChange={(event) =>
                    updateSettings({ defaultVolume: Number(event.target.value) })
                  }
                  aria-label="Default volume"
                  className="h-1 w-32 cursor-pointer appearance-none rounded-full bg-ink-700
                    [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full
                    [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent-400
                    [&::-webkit-slider-thumb]:mt-[-6px] [&::-webkit-slider-thumb]:h-3.5
                    [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-400"
                />
              }
            />
          </Row>
          <Row>
            <SettingRow
              label="Playback speed"
              description={`${settings.defaultPlaybackRate}x`}
              control={
                <SegmentedControl
                  ariaLabel="Default playback speed"
                  size="sm"
                  value={settings.defaultPlaybackRate}
                  onChange={(value) => updateSettings({ defaultPlaybackRate: value })}
                  options={[
                    { value: 1, label: '1x' },
                    { value: 1.25, label: '1.25x' },
                    { value: 1.5, label: '1.5x' },
                    { value: 2, label: '2x' },
                  ]}
                />
              }
            />
          </Row>
        </div>
      </Section>

      <Section title="Browsing" description="Affects the filter bars on every browse page.">
        <div className="divide-y divide-ink-700">
          <Row>
            <Switch
              label="Language filter"
              description="Show a language chip row derived from each entry's `tvg-language`."
              checked={settings.showLanguageFilter}
              onCheckedChange={(value) => updateSettings({ showLanguageFilter: value })}
            />
          </Row>
          <Row>
            <Switch
              label="Country filter"
              description="Derived from the `tvg-country` attribute, shown as ISO codes."
              checked={settings.showCountryFilter}
              onCheckedChange={(value) => updateSettings({ showCountryFilter: value })}
            />
          </Row>
          <Row>
            <Switch
              label="Show uncategorised entries"
              description="Entries that could not be confidently classified as live, movie or series."
              checked={settings.showOtherCategory}
              onCheckedChange={(value) => updateSettings({ showOtherCategory: value })}
            />
          </Row>
          <Row>
            <SettingRow
              label="Card density"
              description="Compact fits more titles per screen."
              control={
                <SegmentedControl
                  ariaLabel="Card density"
                  size="sm"
                  value={settings.cardDensity}
                  onChange={(value) => updateSettings({ cardDensity: value })}
                  options={[
                    { value: 'comfortable', label: 'Comfortable' },
                    { value: 'compact', label: 'Compact' },
                  ]}
                />
              }
            />
          </Row>
          <Row>
            <Switch
              label="Reduce motion"
              description="Disables animated spinners, scale effects and the pulsing live badge."
              checked={settings.reducedMotion}
              onCheckedChange={(value) => updateSettings({ reducedMotion: value })}
            />
          </Row>
        </div>
      </Section>

      <Section
        title="Artwork"
        description="Movie and series posters are fetched from a third-party metadata service."
      >
        <div className="divide-y divide-ink-700">
          <Row>
            <Switch
              label="Fill in missing posters"
              description="When a movie or series has no logo in the playlist, look up a poster by title. Titles are sent to a public metadata service; playlists, streams and viewing history never are. Turn this off to stay fully offline."
              checked={settings.autoFetchPosters}
              onCheckedChange={(value) => updateSettings({ autoFetchPosters: value })}
            />
          </Row>
          <Row>
            <SettingRow
              label="Poster cache"
              description="Clears every stored poster. Anything looked up again will be requested anew."
              control={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // Lazy so the poster system stays out of the first-paint bundle.
                    void import('@/store/posterStore')
                      .then((m) => m.clearAllPosters())
                      .catch(() => undefined);
                  }}
                >
                  Clear
                </Button>
              }
            />
          </Row>
        </div>
      </Section>

      <Section
        title="Parental controls"
        description="Hold adult content back behind a PIN, and reserve a dedicated playlist for the Parent page."
      >
        <div className="divide-y divide-ink-700">
          <Row>
            <Switch
              label="Hide adult content behind a PIN"
              description="Entries filed under a group this player reads as adult (XXX, Adult, 18+) leave Movies, Series, Live TV, Home and Search, and appear only on the Parent page once the PIN is entered. Entries are recognised from the playlist's own group name, so a title alone will not be hidden."
              checked={settings.parentControls}
              onCheckedChange={(value) => {
                updateSettings({ parentControls: value });
                // Turning it on must never leave an old unlock lying around, and
                // turning it off closes the section too.
                lockAdult();
              }}
            />
          </Row>
          {settings.parentControls ? (
            <Row>
              <SettingRow
                label="PIN"
                description={
                  customPin
                    ? 'A PIN of your own is set on this device.'
                    : 'Using the default PIN, 8345. Change it to something a child is unlikely to guess.'
                }
                control={
                  <Button variant="ghost" size="sm" onClick={() => setPinEditorOpen(true)}>
                    {customPin ? 'Change PIN' : 'Set a PIN'}
                  </Button>
                }
              />
            </Row>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-mist-500">
          This is a household convenience lock, not security. The playlist is already on this
          device, so anyone who knows how to open developer tools can read it regardless. The PIN
          is stored hashed and only re-locks when the app is closed.
        </p>
        <p className="mt-2 text-xs text-mist-500">
          If one of your playlists is mostly adult, it is reserved automatically: it moves out of
          normal browsing and is shown only on the Parent page, and every other page keeps using
          whichever playlist you have selected. It is marked &ldquo;Parent only&rdquo; in
          Playlists.
        </p>
      </Section>

      <Section
        title="Ratings"
        description="IMDb scores on cards, detail pages and while playing."
      >
        <div className="divide-y divide-ink-700">
          <Row>
            {/* A real <label> rather than SettingRow's <p>, and deliberately not the
                24px control slot: a text field is taller than a switch and wants to
                hang below the first line instead of being squeezed into it. This row
                also lost its flex wrapper at some point, which stacked the field
                under the label while the `max-w-56` width still assumed side by side. */}
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 sm:flex-nowrap">
              <div className="min-w-0 flex-1">
                <label htmlFor="omdb-key" className="text-sm font-medium text-mist-50">
                  OMDb API key
                </label>
                <p className="mt-0.5 text-xs leading-relaxed text-mist-500">
                  Optional. Ratings come from a keyless public service by default. Add your
                  free key from omdbapi.com to use OMDb instead — it is kept on this device
                  only, never in the app bundle, and is subject to OMDb&apos;s 1,000
                  requests/day limit. Leave it blank to stay on the keyless source.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <input
                  id="omdb-key"
                  type="password"
                  value={settings.omdbApiKey}
                  onChange={(event) => updateSettings({ omdbApiKey: event.target.value })}
                  placeholder="Not set"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full max-w-56 rounded-card border border-ink-700 bg-ink-900 px-3 py-2 text-sm
                    text-mist-50 placeholder:text-mist-600 focus:border-accent-400 focus:outline-none"
                />
                {settings.omdbApiKey ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => updateSettings({ omdbApiKey: '' })}
                    aria-label="Clear OMDb API key"
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>
          </Row>
        </div>
      </Section>

      <Section title="Storage" description="This device only. Nothing is synced or uploaded.">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Playlists" value={playlists.length} />
          <Stat label="Entries loaded" value={itemCount} />
          <Stat label="Favourites" value={favorites.length} />
          <Stat label="In progress" value={progressCount} />
        </dl>

        <div className="mt-4 space-y-2">
          <Button
            variant="danger"
            icon="trash"
            onClick={() => setConfirm('progress')}
            disabled={progressCount === 0 && favorites.length === 0}
          >
            Clear watch progress and favourites
          </Button>
          <Button
            variant="secondary"
            icon="download"
            onClick={() => setConfirm('cache')}
            disabled={itemCount === 0}
          >
            Clear cached playlist entries
          </Button>
        </div>
      </Section>

      <Section title="About">
        <ul className="space-y-2 text-xs leading-relaxed text-mist-500">
          <li className="flex items-start gap-2">
            <Icon name="info" size={13} className="mt-0.5 shrink-0" />
            <span>
              Playlists are fetched directly from their provider by your browser. Providers that
              block cross-origin requests will not work here; that is a provider-side policy, not
              something this app can proxy around.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Icon name="info" size={13} className="mt-0.5 shrink-0" />
            <span>
              No channels, films or streams ship with the app. It plays only what the playlist you
              supply points at.
            </span>
          </li>
        </ul>
      </Section>

      <PageEnd />

      <Modal
        open={pinEditorOpen}
        onClose={() => {
          setPinEditorOpen(false);
          setNewPin('');
          setNewPinConfirm('');
          setPinError(null);
        }}
        title="Set a PIN"
        description="At least 4 digits. You will need it each time the Parent section is opened."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPinEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const invalid = validatePin(newPin);
                if (invalid) {
                  setPinError(invalid);
                  return;
                }
                if (newPin !== newPinConfirm) {
                  setPinError('The two PINs do not match.');
                  return;
                }
                saveAdultPinHash(hashPin(newPin));
                setCustomPin(true);
                setNewPin('');
                setNewPinConfirm('');
                setPinError(null);
                setPinEditorOpen(false);
                setNotice('PIN updated. The Parent section is locked with the new one.');
              }}
            >
              Save PIN
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-mist-300">New PIN</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={newPin}
              onChange={(event) => {
                setNewPin(event.target.value);
                setPinError(null);
              }}
              className="w-full rounded-card border border-ink-700 bg-ink-900 px-3 py-2 text-sm
                text-mist-50 focus:border-accent-400 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-mist-300">Confirm PIN</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={newPinConfirm}
              onChange={(event) => {
                setNewPinConfirm(event.target.value);
                setPinError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.form?.requestSubmit?.();
              }}
              className="w-full rounded-card border border-ink-700 bg-ink-900 px-3 py-2 text-sm
                text-mist-50 focus:border-accent-400 focus:outline-none"
            />
          </label>
          {pinError ? <p className="text-xs text-red-400">{pinError}</p> : null}
          {customPin ? (
            <button
              type="button"
              className="text-xs text-mist-500 underline underline-offset-2 hover:text-mist-300"
              onClick={() => {
                saveAdultPinHash('');
                setCustomPin(false);
                setPinError(null);
                setPinEditorOpen(false);
                setNotice('PIN cleared. The Parent section is locked with the default PIN.');
              }}
            >
              Remove the custom PIN and go back to 8345
            </button>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'progress' ? 'Clear watch data?' : 'Clear cached entries?'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                if (confirm) void run(confirm, () => setConfirm(null));
              }}
            >
              Clear
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-mist-400">
          {confirm === 'progress'
            ? 'This removes resume positions, favourites and recent searches. Your playlists and their entries are untouched, and this cannot be undone.'
            : 'This frees the space used by cached playlist entries. Each playlist keeps its name and URL, so you can re-download it from the Playlists page.'}
        </p>
      </Modal>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="px-4 pb-8 md:px-8">
      <div className="mb-3 flex items-center gap-2.5">
        <span aria-hidden="true" className="rule-accent h-3.5 w-0.5 shrink-0 rounded-full" />
        <h2 className="text-sm font-semibold tracking-tight text-mist-100">{title}</h2>
      </div>
      {description ? <p className="mt-1 mb-3 text-xs text-mist-500">{description}</p> : null}
      <div className="surface-panel rounded-2xl">{children}</div>
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="p-4 transition-colors hover:bg-ink-850/40">{children}</div>;
}

/**
 * A settings row: label and description on the left, a single control on the right.
 *
 * The control slot is a fixed 24px box (`h-6`) aligned to the first line of the
 * label. That height is the one thing every control here shares — a 24px switch,
 * a 28px segmented control, a 32px button — so centring inside it stops a 4px
 * range slider from floating up to the top of the row and stops taller controls
 * from overhanging the label. Rows with no description have nothing to align
 * against, so they centre the whole thing instead.
 */
function SettingRow({
  label,
  description,
  control,
}: {
  label: string;
  description?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-mist-50">{label}</p>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-mist-500">{description}</p>
        ) : null}
      </div>
      <div
        className={`flex h-6 shrink-0 items-center ${description ? 'sm:self-start' : 'sm:self-center'}`}
      >
        {control}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface-panel rounded-xl px-3 py-2.5">
      <dt className="text-[10px] font-semibold tracking-[0.12em] text-mist-500 uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-bold tabular-nums text-mist-50">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
