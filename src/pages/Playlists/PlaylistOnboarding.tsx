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
      className="flex min-h-dvh flex-col items-center justify-center bg-ink-950 px-4 py-10"
    >
      <div className="animate-scale-in w-full max-w-md">
        <div className="mb-7 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-jade-500/12 text-jade-400">
            <Icon name="play" size={24} filled />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-mist-50">Add your playlist</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-mist-400">
            This player reads a playlist you already have access to. It ships with no channels
            and no account.
          </p>
        </div>

        <div className="rounded-xl border border-ink-700 bg-ink-900 p-5">
          <AddPlaylistForm autoFocus submitLabel="Continue" />
        </div>

        <ul className="mt-7 space-y-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink-700 bg-ink-900 text-jade-400">
                <Icon name={step.icon} size={14} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-mist-200">
                  {i + 1}. {step.title}
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
