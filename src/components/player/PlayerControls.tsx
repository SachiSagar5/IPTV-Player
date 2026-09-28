/**
 * Player control bar.
 *
 * Performance: this is the only component that subscribes to the high-frequency
 * player ticks (`currentTime`, `buffered`, `status`). Everything else on the
 * player screen reads a stable slice, so a 4 Hz tick re-renders a progress bar
 * and nothing more.
 *
 * Track menus are only rendered when the stream actually provides them —
 * quality comes from the manifest's level list, audio from its audio groups,
 * subtitles from its subtitle groups. Nothing is invented.
 */
import { memo, useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ContentItem } from '@/types';
import { usePlayerSelector } from '@/store/playerStore';
import { Icon } from '@/components/common/Icon';
import type { IconName } from '@/components/common/Icon';
import { formatTime } from '@/utils/format';
import { cleanTitle } from '@/services/m3u/categorize';
import { RatingBadge } from '@/components/common/RatingBadge';
import { useItemRating } from '@/hooks/useRating';

export interface PlayerControlsProps {
  visible: boolean;
  item: ContentItem;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onSeekBy: (delta: number) => void;
  onVolume: (value: number) => void;
  onToggleMute: () => void;
  onRate: (rate: number) => void;
  onLevel: (index: number) => void;
  onAudioTrack: (index: number) => void;
  onSubtitleTrack: (index: number) => void;
  onBack: () => void;
  onToggleFullscreen: () => void;
  onTogglePip: () => void;
  pipSupported: boolean;
  canGoBack: boolean;
  engineName: string;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const PlayerControls = memo(function PlayerControls({
  visible,
  item,
  onTogglePlay,
  onSeek,
  onSeekBy,
  onVolume,
  onToggleMute,
  onRate,
  onLevel,
  onAudioTrack,
  onSubtitleTrack,
  onBack,
  onToggleFullscreen,
  onTogglePip,
  pipSupported,
  canGoBack,
  engineName,
}: PlayerControlsProps) {
  // High-frequency slices: this component re-renders ~4x/second while playing.
  const currentTime = usePlayerSelector((s) => s.currentTime);
  const duration = usePlayerSelector((s) => s.duration);
  const buffered = usePlayerSelector((s) => s.buffered);
  const status = usePlayerSelector((s) => s.status);
  const volume = usePlayerSelector((s) => s.volume);
  const muted = usePlayerSelector((s) => s.muted);
  const playbackRate = usePlayerSelector((s) => s.playbackRate);
  const isLive = usePlayerSelector((s) => s.isLive);
  const liveLatency = usePlayerSelector((s) => s.liveLatency);
  const isFullscreen = usePlayerSelector((s) => s.fullscreen);
  const isPip = usePlayerSelector((s) => s.pictureInPicture);

  // Low-frequency slices.
  const levels = usePlayerSelector((s) => s.levels);
  const currentLevel = usePlayerSelector((s) => s.currentLevel);
  const autoLevel = usePlayerSelector((s) => s.autoLevelEnabled);
  const audioTracks = usePlayerSelector((s) => s.audioTracks);
  const currentAudioTrack = usePlayerSelector((s) => s.currentAudioTrack);
  const subtitleTracks = usePlayerSelector((s) => s.subtitleTracks);
  const currentSubtitleTrack = usePlayerSelector((s) => s.currentSubtitleTrack);
  const subtitlesEnabled = usePlayerSelector((s) => s.subtitlesEnabled);

  const [menu, setMenu] = useState<'none' | 'quality' | 'audio' | 'subs' | 'speed'>('none');
  const barRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenu('none'), []);
  const isPlaying = status === 'playing' || status === 'buffering';
  const seekingDisabled = isLive;

  const durationLabel = isLive ? 'LIVE' : formatTime(duration);
  const positionLabel = isLive
    ? liveLatency > 1
      ? `${Math.round(liveLatency)}s behind`
      : 'At the edge'
    : formatTime(currentTime);

  // `levels`, `audioTracks` and `subtitleTracks` are all *reordered or filtered*
  // before they reach the store, while the current selection is an index into
  // the engine's own list. So every lookup has to match on the stored `index`/
  // `id` — indexing the array by it silently shows the wrong label once the
  // lists are sorted or an entry is skipped.
  const activeQualityLabel = autoLevel
    ? `Auto${levels.length > 0 ? ` (${levels.find((l) => l.index === currentLevel)?.label ?? levels[0].label})` : ''}`
    : (levels.find((l) => l.index === currentLevel)?.label ?? 'Auto');

  const activeAudioLabel =
    audioTracks.find((t) => t.id === currentAudioTrack)?.label ?? 'Default';

  const activeSubtitleLabel =
    subtitleTracks.find((t) => t.id === currentSubtitleTrack)?.label ?? 'On';

  // A live channel's "title" is a channel name, so this resolves to nothing for
  // live streams and the badge simply never appears.
  const itemRating = useItemRating({ kind: item.kind, title: item.name });

  const volumeIcon: IconName = muted || volume === 0 ? 'volume-mute' : volume < 0.5 ? 'volume-low' : 'volume-high';

  return (
    <div
      ref={barRef}
      className={`absolute inset-x-0 bottom-0 z-20 select-none transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      onMouseLeave={closeMenu}
    >
      {/* Scrim keeps controls legible over bright frames without a heavy blur. */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent"
        aria-hidden="true"
      />

      <div className="relative px-3 pt-16 pb-3 sm:px-5 sm:pb-4">
        {/* Title strip */}
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-white sm:text-base">
              <span className="truncate">{cleanTitle(item.name) || item.name}</span>
              {/* Resolved lazily: the rating needs the title matched to a work
                  first, so it lands a beat after playback starts. */}
              <RatingBadge rating={itemRating} className="shrink-0" />
            </p>
            <p className="truncate text-[11px] text-white/60">
              {item.group ? `${item.group} · ` : ''}
              {engineName === 'native' ? 'Native HLS' : engineName === 'hls.js' ? 'HLS.js' : 'Direct'}
            </p>
          </div>
          {canGoBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Icon name="arrow-left" size={20} />
            </button>
          ) : null}
        </div>

        {/* Seek bar. Range input: keyboard accessible, screen-reader labelled,
            and gives us scrubbing + ARIA for free. */}
        <div className="group/bar relative flex items-center gap-3">
          <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-white/80">
            {positionLabel}
          </span>
          <div className="relative flex-1">
            {/* Buffered bar */}
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full bg-white/40"
                style={{
                  width: `${duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0}%`,
                }}
              />
            </div>
            {seekingDisabled ? (
              <div className="flex h-4 items-center">
                <div className="h-1 w-full rounded-full bg-jade-500/70" />
              </div>
            ) : (
              <input
                type="range"
                min={0}
                max={Math.max(1, duration)}
                step={0.1}
                value={Math.min(currentTime, duration || 0)}
                onChange={(event) => onSeek(Number(event.target.value))}
                aria-label="Seek"
                aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
                className="relative z-10 h-4 w-full cursor-pointer appearance-none bg-transparent
                  [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-jade-400
                  [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full
                  [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:h-3.5
                  [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-jade-400
                  [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(0,0,0,0.45)]"
              />
            )}
          </div>
          <span className="w-14 shrink-0 font-mono text-[11px] tabular-nums text-white/80">
            {durationLabel}
          </span>
        </div>

        {/* Buttons */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <ControlButton
            icon={isPlaying ? 'pause' : 'play'}
            label={isPlaying ? 'Pause' : 'Play'}
            onClick={onTogglePlay}
            filled
            primary
          />
          <ControlButton
            icon="skip-back"
            label="Back 10 seconds"
            onClick={() => onSeekBy(-10)}
            className="hidden sm:flex"
          />
          <ControlButton
            icon="skip-next"
            label="Forward 10 seconds"
            onClick={() => onSeekBy(10)}
            className="hidden sm:flex"
          />

          {/* Volume */}
          <div className="group/vol flex items-center">
            <ControlButton
              icon={volumeIcon}
              label={muted ? 'Unmute' : 'Mute'}
              onClick={onToggleMute}
            />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(event) => onVolume(Number(event.target.value))}
              aria-label="Volume"
              className="hidden h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/30 transition-all duration-200 group-hover/vol:w-20 group-hover/vol:mr-2 group-focus-within/vol:w-20 group-focus-within/vol:mr-2 sm:block
                [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full
                [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white
                [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full
                [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:h-3
                [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
            />
          </div>

          <div className="flex-1" />

          {/* Quality — only if the manifest declares more than one level. */}
          {levels.length > 1 ? (
            <MenuButton
              icon="settings"
              label={`Quality: ${activeQualityLabel}`}
              active={menu === 'quality'}
              onClick={() => setMenu(menu === 'quality' ? 'none' : 'quality')}
            />
          ) : null}

          {/* Audio. Shown as soon as the stream offers at least one alternate
              rendition, because the "Default" entry (the audio muxed into the
              video) is itself a choice — a stream with one alternate plus a
              default has two options, not one. */}
          {audioTracks.length > 0 ? (
            <MenuButton
              icon="audio"
              label={`Audio: ${activeAudioLabel}`}
              active={menu === 'audio'}
              onClick={() => setMenu(menu === 'audio' ? 'none' : 'audio')}
            />
          ) : null}

          {/* Subtitles — only when the stream has subtitle tracks. */}
          {subtitleTracks.length > 0 ? (
            <MenuButton
              icon="subtitles"
              label={
                subtitlesEnabled
                  ? `Subtitles: ${activeSubtitleLabel}`
                  : 'Subtitles off'
              }
              active={menu === 'subs' || subtitlesEnabled}
              onClick={() => setMenu(menu === 'subs' ? 'none' : 'subs')}
            />
          ) : null}

          <MenuButton
            icon="speed"
            label={`Playback speed: ${playbackRate}x`}
            active={menu === 'speed' || playbackRate !== 1}
            onClick={() => setMenu(menu === 'speed' ? 'none' : 'speed')}
            hideLabel
          />

          {pipSupported ? (
            <ControlButton
              icon="pip"
              label={isPip ? 'Exit picture-in-picture' : 'Picture-in-picture'}
              onClick={onTogglePip}
              active={isPip}
              className="hidden sm:flex"
            />
          ) : null}

          <ControlButton
            icon={isFullscreen ? 'fullscreen-exit' : 'fullscreen'}
            label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={onToggleFullscreen}
          />
        </div>
      </div>

      {/* Menus */}
      {menu === 'quality' && levels.length > 0 ? (
        <PlayerMenu label="Quality" onClose={closeMenu}>
          <MenuItem
            label="Auto"
            active={autoLevel}
            onClick={() => {
              onLevel(-1);
              closeMenu();
            }}
          />
          {levels.map((level) => (
            <MenuItem
              key={level.index}
              label={level.label}
              hint={level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : undefined}
              active={!autoLevel && currentLevel === level.index}
              onClick={() => {
                onLevel(level.index);
                closeMenu();
              }}
            />
          ))}
        </PlayerMenu>
      ) : null}

      {menu === 'audio' && audioTracks.length > 0 ? (
        <PlayerMenu label="Audio" onClose={closeMenu}>
          {/* -1 is the audio muxed into the video renditions. Without this there
              is no way back to it once an alternate has been chosen. */}
          <MenuItem
            label="Default"
            active={currentAudioTrack < 0}
            onClick={() => {
              onAudioTrack(-1);
              closeMenu();
            }}
          />
          {audioTracks.map((track) => (
            <MenuItem
              key={track.id}
              label={track.label}
              hint={track.lang && track.lang !== track.label ? track.lang : undefined}
              active={currentAudioTrack === track.id}
              onClick={() => {
                onAudioTrack(track.id);
                closeMenu();
              }}
            />
          ))}
        </PlayerMenu>
      ) : null}

      {menu === 'subs' && subtitleTracks.length > 0 ? (
        <PlayerMenu label="Subtitles" onClose={closeMenu}>
          <MenuItem
            label="Off"
            active={!subtitlesEnabled}
            onClick={() => {
              onSubtitleTrack(-1);
              closeMenu();
            }}
          />
          {subtitleTracks.map((track) => (
            <MenuItem
              key={track.id}
              label={track.label}
              active={subtitlesEnabled && currentSubtitleTrack === track.id}
              onClick={() => {
                onSubtitleTrack(track.id);
                closeMenu();
              }}
            />
          ))}
        </PlayerMenu>
      ) : null}

      {menu === 'speed' ? (
        <PlayerMenu label="Playback speed" onClose={closeMenu}>
          {RATES.map((rate) => (
            <MenuItem
              key={rate}
              label={`${rate}x`}
              active={playbackRate === rate}
              onClick={() => {
                onRate(rate);
                closeMenu();
              }}
            />
          ))}
        </PlayerMenu>
      ) : null}
    </div>
  );
});

/* ---------------- small presentational pieces ---------------- */

function ControlButton({
  icon,
  label,
  onClick,
  filled = false,
  primary = false,
  active = false,
  className = '',
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  filled?: boolean;
  primary?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
        primary
          ? 'bg-white text-black hover:bg-white/85'
          : active
            ? 'bg-white/20 text-white'
            : 'text-white/85 hover:bg-white/10 hover:text-white'
      } ${className}`}
    >
      <Icon name={icon} size={20} filled={filled} />
    </button>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
  active = false,
  hideLabel = false,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  hideLabel?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded={active}
      className={`inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors ${
        active ? 'bg-white/20 text-white' : 'text-white/85 hover:bg-white/10 hover:text-white'
      }`}
    >
      <Icon name={icon} size={18} />
      {!hideLabel ? <span className="hidden sm:inline">{label.replace(/^[A-Za-z ]+: /, '')}</span> : null}
    </button>
  );
}

function PlayerMenu({
  label,
  children,
  onClose,
}: {
  label: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      role="menu"
      aria-label={label}
      className="animate-scale-in absolute right-3 bottom-20 z-30 max-h-[50vh] min-w-44 origin-bottom-right overflow-y-auto rounded-lg border border-white/10 bg-black/85 p-1 shadow-lift backdrop-blur-md sm:right-5"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="px-3 py-1.5 text-[10px] font-bold tracking-[0.14em] text-white/45 uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

function MenuItem({
  label,
  hint,
  active = false,
  onClick,
}: {
  label: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
        active ? 'text-jade-300' : 'text-white/85 hover:bg-white/10'
      }`}
    >
      <Icon name={active ? 'check' : 'minus'} size={14} className={active ? '' : 'opacity-0'} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="shrink-0 text-[10px] text-white/40">{hint}</span> : null}
    </button>
  );
}
