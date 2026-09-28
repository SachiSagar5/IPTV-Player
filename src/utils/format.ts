/** Formatting helpers shared by cards, the player and the progress rows. */

export function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "1h 42m" / "42m" — for metadata lines. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m <= 0) return `${Math.round(totalSeconds)}s`;
  return `${m}m`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const RELATIVE_STEPS: Array<[limitSec: number, divisor: number, unit: Intl.RelativeTimeFormatUnit]> = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86400, 3600, 'hour'],
  [604800, 86400, 'day'],
  [2629800, 604800, 'week'],
  [31557600, 2629800, 'month'],
];

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatRelativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return 'Never';
  const diffSec = (timestamp - Date.now()) / 1000;
  const abs = Math.abs(diffSec);
  for (const [limit, divisor, unit] of RELATIVE_STEPS) {
    if (abs < limit) return rtf.format(Math.round(diffSec / divisor), unit);
  }
  return rtf.format(Math.round(diffSec / 31557600), 'year');
}

export function formatAbsoluteTime(timestamp: number | null | undefined): string {
  if (!timestamp) return 'Never';
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatCount(n: number): string {
  return n.toLocaleString();
}

/** "EP 4 · S2 E7" style subtitle for progress rows. */
export function formatEpisodeLabel(
  season: number | undefined,
  episode: number | undefined,
): string {
  if (season == null && episode == null) return '';
  if (season != null && episode != null) return `S${season} · E${episode}`;
  if (episode != null) return `E${episode}`;
  return `Season ${season}`;
}
