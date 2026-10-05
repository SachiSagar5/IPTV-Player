/**
 * Error boundary for the routed content.
 *
 * React has no hook equivalent, so this is the one class component in the app.
 * It exists so a render-time crash in a single page (a malformed playlist entry,
 * a browser quirk) shows a recoverable message instead of a blank screen — and
 * so a stale chunk after a deploy can be retried in place.
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { ErrorState } from '@/components/common/States';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Changing this value clears the error — used to reset on navigation. */
  resetKey?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  resetKey: string | undefined;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKey: undefined };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    // Navigating away from a broken page clears the error automatically.
    if (props.resetKey !== state.resetKey) {
      return state.error ? { error: null, resetKey: props.resetKey } : { resetKey: props.resetKey };
    }
    return null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept in the console for developers; deliberately not shown to the user.
    console.error('[route error]', error, info.componentStack);
  }

  private readonly handleRetry = (): void => {
    this.setState({ error: null });
  };

  private readonly handleGoBack = (): void => {
    this.setState({ error: null });
    if (window.history.length > 1) window.history.back();
    else window.location.assign('/');
  };

  private readonly handleReload = (): void => {
    // A failed dynamic import is almost always a stale chunk after a deploy.
    window.location.reload();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isChunkError =
      /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
        error.message,
      );

    return (
      <ErrorState
        title={isChunkError ? 'A new version is available' : 'This page could not be displayed'}
        message={
          isChunkError
            ? 'The app was updated since this page was loaded. Reload to pick up the new version.'
            : 'Something in this page failed to render. The rest of the app still works — you can go back and try again.'
        }
        detail={`${error.name}: ${error.message}\n\nStack:\n${error.stack || 'No stack trace'}`}
        onRetry={isChunkError ? this.handleReload : this.handleRetry}
        retryLabel={isChunkError ? 'Reload' : 'Try again'}
        onSecondary={isChunkError ? undefined : this.handleGoBack}
        secondaryLabel="Go back"
      />
    );
  }
}
