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
    <header className="px-4 pt-6 pb-4 md:px-8 md:pt-8">
      <div className="animate-rise flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-mist-50 md:text-2xl">{title}</h1>
          {subtitle ? (
            <div className="mt-1 text-sm text-mist-400">{subtitle}</div>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children ? (
        <div className="animate-rise mt-4" style={{ animationDelay: '110ms' }}>
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
        <div className="mb-3 flex items-center justify-between gap-3 px-4 md:px-8">
          <h2 className="text-sm font-semibold tracking-tight text-mist-200 md:text-base">
            {title}
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
  return <div className="h-16 md:h-8">{children}</div>;
}
