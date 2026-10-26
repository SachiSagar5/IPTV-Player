/**
 * Player control bar.
 *
 * Performance: this is the only component that re-renders on high-frequency
 * player ticks (`currentTime`, `buffered`, `status`). Everything else on the
 * player screen reads a stable slice, so a 4 Hz tick re-renders a progress bar
 * and nothing more.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ContentItem } from '@/types';
import { Icon } from '@/components/common/Icon';
import type { IconName } from '@/components/common/Icon';
import { formatTime } from '@/utils/format';
import { cleanTitle } from '@/services/m3u/categorize';
import { RatingBadge } from '@/components/common/RatingBadge';
import { useItemRating } from '@/hooks/useRating';
import { useDpadNavigation } from '@/hooks/useDpadNavigation';
import { navCandidates } from '@/hooks/navCandidates';
import type { StreamFeatures } from '@/services/hls/nativeSupport';

export interface PlayerControlsProps {
  visible: boolean;
  item: ContentItem;
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'error' | 'ended';
  duration: number;
  currentTime: number;
  buffered: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onSeekBy: (delta: number) => void;
  onVolume: (value: number) => void;
  onToggleMute: () => void;
  onRate: (rate: number) => void;
  onLevel: (index: number) => void;
  onAudioTrack: (index: number) => void;
  onFitMode: () => void;
  onBack: () => void;
  onToggleFullscreen: () => void;
  onTogglePip: () => void;
  pipSupported: boolean;
  canGoBack: boolean;
  engineName: string;
  levels: Array<{ index: number; label: string; height: number; bitrate: number }>;
  currentLevel: number;
  autoLevelEnabled: boolean;
  audioTracks: Array<{ id: number; label: string; lang: string }>;
  currentAudioTrack: number;
  streamFeatures: StreamFeatures;
  onShowControls?: () => void;
  onHideControls?: () => void;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const PlayerControls = memo(function PlayerControls({
  visible,
  item,
  status,
  duration,
  currentTime,
  buffered,
  volume,
  muted,
  playbackRate,
  onTogglePlay,
  onSeek,
  onSeekBy,
  onVolume,
  onToggleMute,
  onRate,
  onLevel,
  onAudioTrack,
  onFitMode,
  onBack,
  onToggleFullscreen,
  onTogglePip,
  pipSupported,
  canGoBack,
  engineName,
  levels,
  currentLevel,
  autoLevelEnabled,
  audioTracks,
  currentAudioTrack,
  streamFeatures,
  onShowControls,
  onHideControls,
}: PlayerControlsProps) {
  const [menu, setMenu] = useState<'none' | 'quality' | 'audio' | 'speed'>('none');
  const barRef = useRef<HTMLDivElement>(null);
  const isLive = item.kind === 'live';
  const isFullscreen = false;
  const [istTime, setIstTime] = useState<string>('');

  useDpadNavigation(barRef, { loop: false });

  // Update IST time every minute
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      // IST is UTC+5:30
      const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
      let hours = ist.getUTCHours();
      const minutes = ist.getUTCMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      setIstTime(`${hours}:${minutes} ${ampm}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, []);

  const closeMenu = useCallback(() => setMenu('none'), []);
  const isPlaying = status === 'playing' || status === 'buffering';
  const seekingDisabled = isLive;

  // Show "Skip Intro" for VOD content in first 3 minutes
  const canSkipIntro = !isLive && currentTime < 180 && duration > 180;

  const handleSkipIntro = useCallback(() => {
    onSeek(currentTime + 90); // Skip 1:30
  }, [currentTime, onSeek]);

  const durationLabel = isLive ? 'LIVE' : formatTime(duration);
  const positionLabel = isLive ? 'At the edge' : formatTime(currentTime);

  const activeQualityLabel = autoLevelEnabled
    ? `Auto${levels.length > 0 ? ` (${levels.find((l) => l.index === currentLevel)?.label ?? levels[0].label})` : ''}`
    : (levels.find((l) => l.index === currentLevel)?.label ?? 'Auto');

  const activeAudioLabel = audioTracks.find((t) => t.id === currentAudioTrack)?.label ?? 'Default';

  const itemRating = useItemRating({ kind: item.kind, title: item.name });

  const volumeIcon: IconName = muted || volume === 0 ? 'volume-mute' : volume < 0.5 ? 'volume-low' : 'volume-high';

  return (
    <div
      ref={barRef}
      data-player-controls=""
      className={`absolute inset-x-0 bottom-0 z-20 select-none transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      onMouseEnter={() => onShowControls?.()}
      onMouseLeave={() => {
        closeMenu();
        onHideControls?.();
      }}
    >
      {/* Enhanced scrim with accent glow at top edge */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent"
        aria-hidden="true"
      />
      {/* Accent glow line at top of controls */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-accent-400/60 to-transparent"
      />

      <div className="relative px-3 pt-16 pb-3 sm:px-5 sm:pb-4">
        {/* Title strip */}
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-white sm:text-base">
              <span className="truncate">{cleanTitle(item.name) || item.name}</span>
              <RatingBadge rating={itemRating} className="shrink-0" />
            </p>
            <p className="truncate text-[11px] text-white/60">
              {item.group ? `${item.group} · ` : ''}
              {engineName === 'native' ? 'Native HLS' : engineName === 'hls.js' ? 'HLS.js' : 'Direct'}
              {istTime && ` · ${istTime}`}
            </p>
            {/* Stream feature badges (HDR/Dolby/Codec/Resolution) */}
            {(streamFeatures.hdr !== 'none' ||
              streamFeatures.dolby !== 'none' ||
              streamFeatures.codec !== 'none' ||
              streamFeatures.resolution !== 'unknown') ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {streamFeatures.resolution !== 'unknown' ? (
                  <Badge variant="resolution">{streamFeatures.resolution.toUpperCase()}</Badge>
                ) : null}
                {streamFeatures.hdr !== 'none' ? (
                  <Badge variant="hdr">{streamFeatures.hdr.toUpperCase()}</Badge>
                ) : null}
                {streamFeatures.dolby !== 'none' ? (
                  <Badge variant="dolby">{streamFeatures.dolby.replace('-', ' ').toUpperCase()}</Badge>
                ) : null}
                {streamFeatures.codec !== 'none' ? (
                  <Badge variant="codec">{streamFeatures.codec.toUpperCase()}</Badge>
                ) : null}
              </div>
            ) : null}
          </div>
          {canGoBack ? (
            <button
              type="button"
              data-nav
              onClick={onBack}
              aria-label="Back"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Icon name="arrow-left" size={20} />
            </button>
          ) : null}
        </div>

        {/* Seek bar */}
        <div className="group/bar relative flex items-center gap-3">
          <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-white/80">
            {positionLabel}
          </span>
          <div className="relative flex-1">
            {/* Buffered bar */}
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full bg-white/30"
                style={{
                  width: `${duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0}%`,
                }}
              />
            </div>
            {seekingDisabled ? (
              <div className="flex h-4 items-center">
                <div className="h-1.5 w-full rounded-full bg-gradient-to-r from-accent-500 to-accent-300" />
              </div>
            ) : (
              <>
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, duration)}
                  step={0.1}
                  value={Math.min(currentTime, duration || 0)}
                  data-nav
                  onChange={(event) => onSeek(Number(event.target.value))}
                  aria-label="Seek"
                  aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
                  className="relative z-10 h-4 w-full cursor-pointer appearance-none bg-transparent
                    [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full
                    [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white
                    [&::-moz-range-thumb]:shadow-[0_0_8px_rgb(var(--accent-400-rgb)/0.6)]
                    [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full
                    [&::-webkit-slider-runnable-track]:bg-gradient-to-r
                    [&::-webkit-slider-runnable-track]:from-accent-500
                    [&::-webkit-slider-runnable-track]:via-accent-400
                    [&::-webkit-slider-runnable-track]:to-accent-300
                    [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:h-4
                    [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                    [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgb(var(--accent-400-rgb)/0.7)]
                    group-hover/bar:[&::-webkit-slider-thumb]:scale-125
                    group-focus-visible/bar:[&::-webkit-slider-thumb]:scale-125
                    transition-transform duration-150"
                />
                {/* Progress glow on hover */}
                <div
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-gradient-to-r from-accent-500 via-accent-400 to-accent-300 opacity-0 group-hover/bar:opacity-100 transition-opacity duration-200"
                  style={{
                    width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%`,
                  }}
                />
              </>
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
          {canSkipIntro ? (
            <ControlButton
              icon="skip-next"
              label="Skip intro (+1:30)"
              onClick={handleSkipIntro}
            />
          ) : null}

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
              className="hidden h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/20 transition-all duration-200 group-hover/vol:w-20 group-hover/vol:mr-2 group-focus-within/vol:w-20 group-focus-within/vol:mr-2 sm:block
                [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full
                [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white
                [&::-moz-range-thumb]:shadow-[0_0_8px_rgb(var(--accent-400-rgb)/0.6)]
                [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full
                [&::-webkit-slider-runnable-track]:bg-gradient-to-r
                [&::-webkit-slider-runnable-track]:from-accent-500
                [&::-webkit-slider-runnable-track]:to-accent-300
                [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:h-3.5
                [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgb(var(--accent-400-rgb)/0.7)]
                group-hover/vol:[&::-webkit-slider-thumb]:scale-125
                group-focus-within/vol:[&::-webkit-slider-thumb]:scale-125
                transition-transform duration-150"
            />
          </div>

          <div className="flex-1" />

          {levels.length > 1 ? (
            <MenuButton
              icon="settings"
              label={`Quality: ${activeQualityLabel}`}
              active={menu === 'quality'}
              onClick={() => setMenu(menu === 'quality' ? 'none' : 'quality')}
            />
          ) : null}

          {audioTracks.length > 0 ? (
            <>
              <MenuButton
                icon="audio"
                label={`Audio: ${activeAudioLabel}`}
                active={menu === 'audio'}
                onClick={() => setMenu(menu === 'audio' ? 'none' : 'audio')}
              />
              {audioTracks.length > 1 && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 text-[10px] text-accent-400/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-500 animate-pulse" />
                  {audioTracks.length} tracks
                </span>
              )}
            </>
          ) : null}

          <ControlButton
            icon="maximize-2"
            label="Fit mode"
            onClick={onFitMode}
            className="hidden sm:flex"
          />

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
              label="Picture-in-picture"
              onClick={onTogglePip}
              className="hidden sm:flex"
            />
          ) : null}

          <ControlButton
            icon={isFullscreen ? 'fullscreen-exit' : 'fullscreen'}
            label="Fullscreen"
            onClick={onToggleFullscreen}
          />
        </div>
      </div>

      {/* Menus */}
      {menu === 'quality' && levels.length > 1 ? (
        <PlayerMenu label="Quality" onClose={closeMenu}>
          <MenuItem
            label="Auto"
            active={autoLevelEnabled}
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
              active={!autoLevelEnabled && currentLevel === level.index}
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
          <MenuItem
            label="Default (Auto)"
            hint="Let the player choose the best audio track"
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
              hint={track.lang && track.lang !== track.label ? `Language: ${track.lang.toUpperCase()}` : undefined}
              active={currentAudioTrack === track.id}
              onClick={() => {
                onAudioTrack(track.id);
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
      data-nav
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400 ${
        primary
          ? 'bg-gradient-to-br from-accent-300 to-accent-500 text-ink-1000 shadow-glow hover:from-accent-200 hover:to-accent-400 hover:shadow-glow-lg'
          : active
          ? 'bg-white/20 text-white shadow-[0_0_16px_rgb(var(--accent-400-rgb)/0.4)]'
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
      data-nav
      className={`inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-all duration-200 hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400 ${
        active
          ? 'bg-gradient-to-r from-accent-500/30 to-accent-600/30 text-mist-50 shadow-[0_0_12px_rgb(var(--accent-400-rgb)/0.3)_inset]'
          : 'text-white/85 hover:bg-white/10 hover:text-white'
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
  const menuRef = useRef<HTMLDivElement>(null);

  useDpadNavigation(menuRef, { loop: false });

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      navCandidates(menuRef.current ?? document)[0]?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className="animate-scale-in absolute right-3 bottom-20 z-30 max-h-[50vh] min-w-44 origin-bottom-right overflow-y-auto rounded-xl border border-white/10 bg-gradient-to-b from-black/95 to-black/85 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.8),0_0_30px_rgb(var(--accent-400-rgb)/0.15)] backdrop-blur-xl sm:right-5"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2 mb-1">
        <div className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-accent-500 to-accent-300" />
        <p className="text-[10px] font-bold tracking-[0.14em] text-white/70 uppercase">
          {label}
        </p>
      </div>
      {children}
    </div>
  );
}

function Badge({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: 'hdr' | 'dolby' | 'codec' | 'resolution';
}) {
  const variantStyles: Record<string, string> = {
    hdr: 'bg-gradient-to-r from-amber-500/30 to-amber-600/20 text-amber-300 border-amber-500/40',
    dolby: 'bg-gradient-to-r from-blue-500/30 to-blue-600/20 text-blue-300 border-blue-500/40',
    codec: 'bg-gradient-to-r from-purple-500/30 to-purple-600/20 text-purple-300 border-purple-500/40',
    resolution: 'bg-gradient-to-r from-green-500/30 to-green-600/20 text-green-300 border-green-500/40',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[9px] font-bold tracking-[0.1em] uppercase rounded-full border backdrop-blur-sm shadow-[0_0_10px_rgba(0,0,0,0.3)] ${
        variantStyles[variant] ?? variantStyles.hdr
      }`}
    >
      {children}
    </span>
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
      data-nav
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400 ${
        active
          ? 'bg-gradient-to-r from-accent-500/20 to-accent-600/10 text-accent-200 shadow-[0_0_10px_rgb(var(--accent-400-rgb)/0.2)_inset]'
          : 'text-white/85 hover:bg-white/10 hover:text-white'
      }`}
    >
      <Icon name={active ? 'check' : 'minus'} size={14} className={active ? 'text-accent-400' : 'text-white/30'} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="shrink-0 text-[10px] text-white/40">{hint}</span> : null}
    </button>
  );
}