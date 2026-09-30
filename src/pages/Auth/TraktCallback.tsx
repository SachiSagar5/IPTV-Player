/**
 * Trakt OAuth callback page.
 * Handles the redirect from Trakt after user authorization.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Spinner } from '@/components/common/Button';

export default function TraktCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completing authorization...');
  const [redirectTo, setRedirectTo] = useState('/');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      setMessage(`Authorization failed: ${error}`);
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setMessage('Invalid callback: missing code or state');
      return;
    }

    // Exchange code for tokens
    fetch('/api/trakt/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.tokens) {
          localStorage.setItem('trakt_tokens', JSON.stringify(data.tokens));
          setStatus('success');
          setMessage('Successfully connected to Trakt!');
          setRedirectTo(data.redirectTo ?? '/');
        } else {
          setStatus('error');
          setMessage(data.error ?? 'Failed to exchange code for tokens');
        }
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.message ?? 'Network error');
      });
  }, [searchParams]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink-950 px-4">
        <div className="animate-rise w-full max-w-md text-center">
          <Spinner size={40} className="mx-auto text-accent-400" />
          <h2 className="mt-4 text-lg font-semibold text-white">Connecting to Trakt...</h2>
          <p className="mt-2 text-sm text-white/60">{message}</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink-950 px-4">
        <div className="animate-rise w-full max-w-md text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500/12 text-red-400">
            <Icon name="alert" size={28} />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-white">Authorization failed</h2>
          <p className="mt-2 text-sm text-white/70">{message}</p>
          <Button onClick={() => navigate('/settings')} variant="primary" className="mt-6" icon="arrow-left">
            Back to Settings
          </Button>
        </div>
      </div>
    );
  }

  // Success - auto redirect after 2 seconds
  useEffect(() => {
    const timer = setTimeout(() => navigate(redirectTo), 2000);
    return () => clearTimeout(timer);
  }, [navigate, redirectTo]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink-950 px-4">
      <div className="animate-rise w-full max-w-md text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/12 text-green-400">
          <Icon name="check" size={28} />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-white">Connected to Trakt</h2>
        <p className="mt-2 text-sm text-white/70">{message}</p>
        <p className="mt-4 text-xs text-white/40">Redirecting in 2 seconds...</p>
      </div>
    </div>
  );
}