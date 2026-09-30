/**
 * Trakt.tv integration hooks.
 */
import { useCallback, useEffect, useState } from 'react';
import type { TraktTokens } from '@/services/trakt/client';

const TRAKT_STORAGE_KEY = 'trakt_tokens';
const TRAKT_REDIRECT_KEY = 'trakt_redirect_after_auth';

export function useTraktAuth() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(TRAKT_STORAGE_KEY);
    if (stored) {
      try {
        JSON.parse(stored);
        setIsConnected(true);
      } catch {
        localStorage.removeItem(TRAKT_STORAGE_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  const connect = useCallback((e?: React.MouseEvent) => {
    e?.preventDefault();
    localStorage.setItem(TRAKT_REDIRECT_KEY, window.location.pathname + window.location.search);
    window.location.href = '/api/trakt/auth';
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(TRAKT_STORAGE_KEY);
    setIsConnected(false);
  }, []);

  const getTokens = useCallback((): TraktTokens | null => {
    const stored = localStorage.getItem(TRAKT_STORAGE_KEY);
    if (!stored) return null;
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }, []);

  const setTokens = useCallback((tokens: TraktTokens | null) => {
    if (tokens) {
      localStorage.setItem(TRAKT_STORAGE_KEY, JSON.stringify(tokens));
      setIsConnected(true);
    } else {
      localStorage.removeItem(TRAKT_STORAGE_KEY);
      setIsConnected(false);
    }
  }, []);

  return {
    isConnected,
    isLoading,
    connect,
    disconnect,
    getTokens,
    setTokens,
  };
}

export function useTraktSync() {
  const { getTokens, isConnected } = useTraktAuth();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getHeaders = useCallback(() => {
    const tokens = getTokens();
    if (!tokens) throw new Error('Not connected');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens.access_token}`,
    };
  }, [getTokens]);

  const syncWatched = useCallback(async (direction: 'push' | 'pull') => {
    if (!isConnected) throw new Error('Not connected to Trakt');
    setIsSyncing(true);
    setError(null);

    try {
      if (direction === 'pull') {
        const response = await fetch('/api/trakt/sync/watched', {
          headers: getHeaders(),
        });
        if (!response.ok) throw new Error('Failed to fetch watched history');
        const { shows, movies } = await response.json();
        // TODO: Merge with local progress
        return { shows, movies };
      } else {
        // Push local progress to Trakt
        // TODO: Implement
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sync failed';
      setError(msg);
      throw e;
    } finally {
      setIsSyncing(false);
      setLastSync(Date.now());
    }
  }, [isConnected, getHeaders]);

  const fetchRecommendations = useCallback(async (type: 'shows' | 'movies') => {
    if (!isConnected) return [];
    try {
      const response = await fetch(`/api/trakt/sync/recommendations?type=${type}`, {
        headers: getHeaders(),
      });
      if (!response.ok) return [];
      const { recommendations } = await response.json();
      return recommendations;
    } catch {
      return [];
    }
  }, [isConnected, getHeaders]);

  return {
    isSyncing,
    lastSync,
    error,
    syncWatched,
    fetchRecommendations,
  };
}