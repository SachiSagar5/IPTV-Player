/**
 * Player state — a **separate store** on purpose.
 *
 * `timeupdate` fires ~4x/second. If that lived in the app store, every row on
 * Home would re-render four times a second. Instead the player owns its store
 * and only the control bar / progress bar subscribe to the tick.
 */
import { Store, useStoreSelector } from './store';
import type { ContentItem } from '@/types';

export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'buffering'
  | 'paused'
  | 'playing'
  | 'ended'
  | 'error';

export interface QualityLevel {
  index: number;
  label: string;
  height: number;
  bitrate: number;
}

export interface AudioTrackInfo {
  id: number;
  label: string;
  lang: string;
}

export interface SubtitleTrackInfo {
  id: number;
  label: string;
  lang: string;
}

export interface PlayerErrorInfo {
  /** Player-safe, human message. Never a raw JS error. */
  message: string;
  detail?: string;
  /** True when retrying the same stream is worth attempting. */
  recoverable: boolean;
  attempts: number;
}

export interface PlayerState {
  item: ContentItem | null;
  status: PlayerStatus;
  /** True when native HLS is in use (Safari / iOS) instead of hls.js. */
  native: boolean;

  currentTime: number;
  duration: number;
  /** Live edge offset in seconds; 0 for VOD. */
  liveLatency: number;
  isLive: boolean;
  buffered: number;

  volume: number;
  muted: boolean;
  playbackRate: number;

  levels: QualityLevel[];
  /** -1 === Auto. */
  currentLevel: number;
  autoLevelEnabled: boolean;

  audioTracks: AudioTrackInfo[];
  currentAudioTrack: number;

  subtitleTracks: SubtitleTrackInfo[];
  currentSubtitleTrack: number;
  subtitlesEnabled: boolean;

  controlsVisible: boolean;
  fullscreen: boolean;
  pictureInPicture: boolean;
  seeking: boolean;

  error: PlayerErrorInfo | null;
  /** Epoch ms of when playback actually started, for the recents list. */
  startedAt: number | null;
  /** Total seconds of playback, persisted as "watched". */
  watchedSec: number;
}

const initialState: PlayerState = {
  item: null,
  status: 'idle',
  native: false,
  currentTime: 0,
  duration: 0,
  liveLatency: 0,
  isLive: false,
  buffered: 0,
  volume: 1,
  muted: false,
  playbackRate: 1,
  levels: [],
  currentLevel: -1,
  autoLevelEnabled: true,
  audioTracks: [],
  currentAudioTrack: -1,
  subtitleTracks: [],
  currentSubtitleTrack: -1,
  subtitlesEnabled: false,
  controlsVisible: true,
  fullscreen: false,
  pictureInPicture: false,
  seeking: false,
  error: null,
  startedAt: null,
  watchedSec: 0,
};

export const playerStore = new Store<PlayerState>(initialState);

export function resetPlayer(): void {
  playerStore.setState(initialState);
}

export function closePlayer(): void {
  playerStore.setState(initialState);
}

/* ---------------- selectors ---------------- */

export const selectStatus = (s: PlayerState): PlayerStatus => s.status;
export const selectItem = (s: PlayerState): ContentItem | null => s.item;
export const selectTime = (s: PlayerState): number => s.currentTime;
export const selectDuration = (s: PlayerState): number => s.duration;
export const selectError = (s: PlayerState): PlayerErrorInfo | null => s.error;
export const selectControlsVisible = (s: PlayerState): boolean => s.controlsVisible;
export const selectIsLive = (s: PlayerState): boolean => s.isLive;
export const selectLevels = (s: PlayerState): QualityLevel[] => s.levels;
export const selectCurrentLevel = (s: PlayerState): number => s.currentLevel;
export const selectAutoLevel = (s: PlayerState): boolean => s.autoLevelEnabled;
export const selectAudioTracks = (s: PlayerState): AudioTrackInfo[] => s.audioTracks;
export const selectCurrentAudioTrack = (s: PlayerState): number => s.currentAudioTrack;
export const selectSubtitleTracks = (s: PlayerState): SubtitleTrackInfo[] => s.subtitleTracks;
export const selectCurrentSubtitle = (s: PlayerState): number => s.currentSubtitleTrack;
export const selectSubtitlesEnabled = (s: PlayerState): boolean => s.subtitlesEnabled;
export const selectFullscreen = (s: PlayerState): boolean => s.fullscreen;
export const selectBufferPercent = (s: PlayerState): number =>
  s.duration > 0 ? Math.min(1, s.buffered / s.duration) : 0;

export function usePlayerSelector<T>(selector: (s: PlayerState) => T): T {
  return useStoreSelector(playerStore, selector);
}
