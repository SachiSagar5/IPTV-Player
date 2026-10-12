/**
 * Shared page chrome: title block and a section container.
 * Keeps headings, spacing and the trailing spacer identical across all pages.
 */
import { memo } from 'react';
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export const PageHeader = memo(function PageHeader({
  title,
  subtitle,
  actions,
  children,
}: PageHeaderProps) {
  return (
    <header className="px-4 pt-7 pb-5 md:px-8 md:pt-10 relative">
      {/* Ambient glow behind title */}
      <div
        aria-hidden="true"
        className="absolute top-1/2 left-4 -translate-y-1/2 h-24 w-24 md:left-8 md:w-32 rounded-full bg-gradient-to-r from-accent-500/10 to-transparent blur-2xl opacity-50 animate-drift-b"
      />
      <div className="animate-rise relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 relative">
          {/* Accent rule above the title gives every page the same top-of-page
              anchor the content rows have, so scrolling between pages reads as
              a change of section rather than a change of document. */}
          <span aria-hidden="true" className="rule-accent mb-3 block h-px w-14 rounded-full transition-all duration-500 group-hover/row:w-20" />
          <h1 className="text-display text-2xl font-bold text-mist-50 md:text-4xl bg-gradient-to-r from-mist-50 via-accent-200 to-mist-50 bg-clip-text text-transparent">
            {title}
          </h1>
          {subtitle ? <div className="mt-2 text-sm text-mist-400">{subtitle}</div> : null}
        </div>
        {actions ? <div className="mt-1 flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children ? (
        <div className="animate-rise mt-5" style={{ animationDelay: '110ms' }}>
          {children}
        </div>
      ) : null}
    </header>
  );
});

export function PageSection({
  title,
  children,
  action,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`animate-rise mb-10 ${className}`} style={{ animationDelay: '90ms' }}>
      {title ? (
        <div className="mb-4 flex items-center justify-between gap-3 px-4 md:px-8">
          <h2 className="flex min-w-0 items-center gap-2.5 text-sm font-semibold tracking-tight text-mist-200 md:text-base">
            <span aria-hidden="true" className="rule-accent h-3.5 w-0.5 shrink-0 rounded-full" />
            <span className="truncate">{title}</span>
          </h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Bottom spacer so the last row is not hidden behind the mobile tab bar. */
export function PageEnd({ children }: { children?: ReactNode }) {
  return <div className="h-16 md:h-8 bg-ink-950">{children}</div>;
}
