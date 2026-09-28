/**
 * First-run onboarding.
 *
 * Rendered by `BootGate` instead of the app when no playlist is saved. It is
 * deliberately a single question — "what is your playlist URL" — because the
 * alternative (an empty home screen with seven empty tabs) is the most common
 * way a media app gets abandoned on first launch.
 */
import { useRef } from 'react';
import { AddPlaylistForm } from '@/components/playlist/AddPlaylistForm';
import { Icon } from '@/components/common/Icon';
import { useDpadNavigation } from '@/hooks/useDpadNavigation';

const STEPS = [
  {
    icon: 'link' as const,
    title: 'Paste a playlist URL',
    body: 'Any M3U/M3U8 file your provider gives you. Nothing is bundled with the app.',
  },
  {
    icon: 'sparkle' as const,
    title: 'It is parsed on this device',
    body: 'Channels, movies and series are detected locally in a background worker, then stored offline.',
  },
  {
    icon: 'tv' as const,
    title: 'It just plays',
    body: 'HLS with automatic quality selection, plus your own favourites and watch progress.',
  },
];

export function PlaylistOnboarding() {
  const rootRef = useRef<HTMLDivElement>(null);
  useDpadNavigation(rootRef, { loop: false });

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-ink-950 px-4 py-10"
    >
      {/* Decorative light pools. Two elements, `aria-hidden`, and behind the
          content, so nothing here is reachable by pointer or by a D-pad step. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="animate-drift-a absolute -top-[28vh] -left-[12vw] h-[68vh] w-[68vw] rounded-full bg-accent-500/16 blur-[110px]" />
        <div className="animate-drift-b absolute top-[10vh] -right-[16vw] h-[58vh] w-[58vw] rounded-full bg-violet-500/12 blur-[120px]" />
      </div>

      <div className="animate-scale-in relative w-full max-w-md">
        <div className="mb-7 text-center">
          <span className="relative mx-auto mb-5 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-accent-300 to-accent-500 text-ink-1000 shadow-glow-lg">
            <Icon name="play" size={26} filled />
            <span className="sheen absolute inset-0" aria-hidden="true" />
          </span>
          <h1 className="text-display text-3xl font-bold text-mist-50">
            <span className="text-accent-gradient">IPTV</span> Player
          </h1>
          <p className="mx-auto mt-2.5 max-w-sm text-sm leading-relaxed text-mist-400">
            This player reads a playlist you already have access to. It ships with no channels
            and no account.
          </p>
        </div>

        <div className="surface-panel rounded-2xl p-5">
          <AddPlaylistForm autoFocus submitLabel="Continue" />
        </div>

        <ul className="mt-7 space-y-3">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="surface-panel animate-rise flex items-start gap-3 rounded-xl px-3.5 py-3"
              style={{ animationDelay: `${120 + i * 90}ms` }}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-500/12 text-accent-300">
                <Icon name={step.icon} size={15} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-mist-100">
                  {step.title}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-mist-500">
                  {step.body}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
