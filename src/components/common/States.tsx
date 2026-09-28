/**
 * User-facing state components: errors, empty results, skeletons, banners.
 *
 * Design rule: a user never sees a raw exception. Every failure path in the app
 * funnels into `ErrorState`, which shows a human sentence plus the recovery
 * action that makes sense for that specific failure.
 */
import { memo } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface ErrorStateProps {
  title?: string;
  message: string;
  /** Technical detail, collapsed behind a disclosure. Never shown by default. */
  detail?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  onBack?: () => void;
  onSecondary?: () => void;
  secondaryLabel?: string;
  icon?: IconName;
  className?: string;
  compact?: boolean;
}

export const ErrorState = memo(function ErrorState({
  title = 'Something went wrong',
  message,
  detail,
  onRetry,
  retryLabel = 'Retry',
  onBack,
  onSecondary,
  secondaryLabel,
  icon = 'alert',
  className = '',
  compact = false,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center text-center ${
        compact ? 'gap-3 py-8 px-4' : 'gap-4 py-14 px-6'
      } ${className}`}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-live-500/12 text-live-400">
        <Icon name={icon} size={24} />
      </div>
      <div className="max-w-md space-y-1.5">
        <h2 className="text-base font-semibold text-mist-50">{title}</h2>
        <p className="text-sm leading-relaxed text-mist-400">{message}</p>
        {detail ? (
          <details className="pt-1 text-left">
            <summary className="cursor-pointer text-xs text-mist-500 select-none hover:text-mist-400">
              Technical details
            </summary>
            <pre className="mt-1.5 overflow-x-auto rounded border border-ink-700 bg-ink-900 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-mist-500">
              {detail}
            </pre>
          </details>
        ) : null}
      </div>
      {onRetry || onBack || onSecondary ? (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {onRetry ? (
            <Button icon="refresh" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {onSecondary ? (
            <Button variant="secondary" onClick={onSecondary}>
              {secondaryLabel ?? 'Continue'}
            </Button>
          ) : null}
          {onBack ? (
            <Button variant="ghost" icon="arrow-left" onClick={onBack}>
              Back
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export const EmptyState = memo(function EmptyState({
  icon = 'search',
  title,
  message,
  action,
  className = '',
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? 'gap-3 py-8 px-4' : 'gap-4 py-16 px-6'
      } ${className}`}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-800 text-mist-500">
        <Icon name={icon} size={24} />
      </div>
      <div className="max-w-md space-y-1.5">
        <h2 className="text-base font-semibold text-mist-50">{title}</h2>
        {message ? <p className="text-sm leading-relaxed text-mist-400">{message}</p> : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
});

/* ---------------- skeletons ---------------- */

export function SkeletonPoster({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-card ${className}`} style={{ aspectRatio: '2 / 3' }} />;
}

export function SkeletonRow({ count = 6 }: { count?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden px-4 md:px-8">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="w-[132px] shrink-0 sm:w-[164px] lg:w-[190px]">
          <SkeletonPoster />
          <div className="skeleton mt-2 h-3 w-4/5 rounded" />
          <div className="skeleton mt-1.5 h-2.5 w-2/5 rounded" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonChannelRow({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:px-8 lg:grid-cols-5 xl:grid-cols-7">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="skeleton rounded-card" style={{ aspectRatio: '1 / 1' }} />
          <div className="skeleton mt-2 h-3 w-3/5 rounded" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`skeleton h-3 rounded ${className}`} />;
}

export interface InlineBannerProps {
  message: string;
  tone?: 'error' | 'info' | 'success';
  onDismiss?: () => void;
  action?: ReactNode;
}

export const InlineBanner = memo(function InlineBanner({
  message,
  tone = 'error',
  onDismiss,
  action,
}: InlineBannerProps) {
  const tones = {
    error: 'border-live-500/35 bg-live-500/10 text-mist-200',
    info: 'border-ink-600 bg-ink-800 text-mist-200',
    success: 'border-jade-600/40 bg-jade-600/10 text-mist-200',
  } as const;

  return (
    <div
      role="status"
      className={`animate-slide-up flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}
    >
      <Icon
        name={tone === 'error' ? 'alert' : tone === 'success' ? 'check' : 'info'}
        size={18}
        className={tone === 'error' ? 'text-live-400' : 'text-jade-400'}
      />
      <span className="min-w-0 flex-1">{message}</span>
      {action}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="rounded p-1 text-mist-500 transition-colors hover:bg-ink-700 hover:text-mist-200"
        >
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );
});
