/** Dismissible banner for app-level (non page-level) errors. */
import { memo } from 'react';
import { InlineBanner } from '@/components/common/States';
import { dismissError, useAppSelector } from '@/store/appStore';

export const ErrorBanner = memo(function ErrorBanner() {
  const error = useAppSelector((s) => s.error);
  if (!error) return null;
  return (
    <div className="sticky top-14 z-30 px-4 pt-2 md:top-16 md:px-6">
      <InlineBanner message={error.message} onDismiss={dismissError} />
    </div>
  );
});
