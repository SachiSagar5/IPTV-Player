/**
 * Trakt.tv API client with OAuth PKCE support.
 *
 * Handles authentication, token refresh, and API calls.
 * All sensitive operations use server-side proxy via Vercel functions.
 */
import { createHash, randomBytes } from 'crypto';

const TRAKT_API_BASE = 'https://api.trakt.tv';
const TRAKT_OAUTH_BASE = 'https://trakt.tv/oauth';

export interface TraktTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'Bearer';
  scope: string;
  created_at: number;
}

export interface TraktShow {
  title: string;
  year: number;
  ids: { trakt: number; slug: string; tvdb?: number; imdb?: string; tmdb?: number };
}

export interface TraktMovie {
  title: string;
  year: number;
  ids: { trakt: number; slug: string; imdb?: string; tmdb?: number };
}

export interface TraktEpisode {
  season: number;
  number: number;
  title: string;
  ids: { trakt: number; tvdb?: number; imdb?: string };
}

export interface TraktWatchedShow {
  show: TraktShow;
  last_watched_at: string;
  plays: number;
  completed_seasons: number;
  aired_episodes: number;
  completed: number;
  next_episode?: { season: number; number: number };
  last_episode?: TraktEpisode;
}

export interface TraktWatchedMovie {
  movie: TraktMovie;
  last_watched_at: string;
  plays: number;
}

export interface TraktHistoryEpisode {
  watched_at: string;
  episode: TraktEpisode;
  show: TraktShow;
}

export interface TraktHistoryMovie {
  watched_at: string;
  movie: TraktMovie;
}

/**
 * Generate PKCE code verifier and challenge.
 * Used for secure OAuth flow without client secret on client side.
 */
export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Build authorization URL for Trakt OAuth.
 * Redirect user to this URL to grant permission.
 */
export function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  challenge: string,
  state: string
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: 'public account sync',
  });
  return `${TRAKT_OAUTH_BASE}/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for access/refresh tokens.
 * Called from server-side (Vercel function) to keep client secret secure.
 */
export async function exchangeCodeForTokens(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
  verifier: string
): Promise<TraktTokens> {
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });

  const response = await fetch(`${TRAKT_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${response.status} ${JSON.stringify(error)}`);
  }

  const tokens = await response.json();
  return {
    ...tokens,
    created_at: Date.now(),
  };
}

/**
 * Refresh access token using refresh token.
 */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<TraktTokens> {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
  });

  const response = await fetch(`${TRAKT_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Token refresh failed: ${response.status} ${JSON.stringify(error)}`);
  }

  const tokens = await response.json();
  return {
    ...tokens,
    created_at: Date.now(),
  };
}

/**
 * Check if access token is expired (with 60s buffer).
 */
export function isTokenExpired(tokens: TraktTokens): boolean {
  const expiry = tokens.created_at + (tokens.expires_in - 60) * 1000;
  return Date.now() >= expiry;
}

/**
 * Trakt API client for authenticated requests.
 */
export class TraktClient {
  private tokens: TraktTokens | null = null;
  private clientId: string;
  private clientSecret: string;

  constructor(clientId: string, clientSecret: string, tokens?: TraktTokens) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tokens = tokens ?? null;
  }

  setTokens(tokens: TraktTokens | null): void {
    this.tokens = tokens;
  }

  getTokens(): TraktTokens | null {
    return this.tokens;
  }

  private async ensureValidToken(): Promise<string> {
    if (!this.tokens) throw new Error('Not authenticated');
    if (isTokenExpired(this.tokens)) {
      if (!this.tokens.refresh_token) throw new Error('No refresh token');
      this.tokens = await refreshAccessToken(this.clientId, this.clientSecret, this.tokens.refresh_token);
    }
    return this.tokens.access_token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.ensureValidToken();
    const response = await fetch(`${TRAKT_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': this.clientId,
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (response.status === 401) {
      // Token expired, try refresh once
      if (this.tokens?.refresh_token) {
        this.tokens = await refreshAccessToken(this.clientId, this.clientSecret, this.tokens.refresh_token);
        const token = this.tokens.access_token;
        const retry = await fetch(`${TRAKT_API_BASE}${endpoint}`, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            'trakt-api-version': '2',
            'trakt-api-key': this.clientId,
            Authorization: `Bearer ${token}`,
            ...options.headers,
          },
        });
        if (!retry.ok) throw new Error(`API error: ${retry.status}`);
        return retry.json();
      }
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`API error: ${response.status} ${JSON.stringify(error)}`);
    }

    if (response.status === 204) return null as T;
    return response.json();
  }

  // ===== Watched History Sync =====

  /** Get watched shows (with progress). */
  async getWatchedShows(): Promise<TraktWatchedShow[]> {
    return this.request<TraktWatchedShow[]>('/sync/watched/shows');
  }

  /** Get watched movies. */
  async getWatchedMovies(): Promise<TraktWatchedMovie[]> {
    return this.request<TraktWatchedMovie[]>('/sync/watched/movies');
  }

  /** Get watch history (episodes + movies) with pagination. */
  async getHistory(options: { limit?: number; after?: string; before?: string } = {}): Promise<(TraktHistoryEpisode | TraktHistoryMovie)[]> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.after) params.set('after', options.after);
    if (options.before) params.set('before', options.before);
    return this.request<(TraktHistoryEpisode | TraktHistoryMovie)[]>(`/sync/history?${params.toString()}`);
  }

  /** Add items to watched history. */
  async addToHistory(items: { episodes?: { ids: TraktEpisode['ids']; watched_at: string }[]; movies?: { ids: TraktMovie['ids']; watched_at: string }[] }): Promise<{ added: { episodes: number; movies: number }; not_found: { episodes: number; movies: number } }> {
    return this.request('/sync/history', {
      method: 'POST',
      body: JSON.stringify(items),
    });
  }

  /** Remove items from watched history. */
  async removeFromHistory(items: { episodes?: { ids: TraktEpisode['ids'] }[]; movies?: { ids: TraktMovie['ids'] }[] }): Promise<{ deleted: { episodes: number; movies: number }; not_found: { episodes: number; movies: number } }> {
    return this.request('/sync/history/remove', {
      method: 'POST',
      body: JSON.stringify(items),
    });
  }

  // ===== Collection =====

  async getCollectionShows(): Promise<Array<{ show: TraktShow; last_collected_at: string; collected_episodes: number }>> {
    return this.request('/sync/collection/shows');
  }

  async getCollectionMovies(): Promise<Array<{ movie: TraktMovie; collected_at: string }>> {
    return this.request('/sync/collection/movies');
  }

  // ===== Ratings =====

  async getRatings(type: 'shows' | 'movies' | 'episodes' | 'seasons'): Promise<Array<{ rating: number; rated_at: string; show?: TraktShow; movie?: TraktMovie; episode?: TraktEpisode; season?: { number: number; ids: { trakt: number } } }>> {
    return this.request(`/sync/ratings/${type}`);
  }

  // ===== Recommendations =====

  async getRecommendations(type: 'shows' | 'movies'): Promise<Array<{ show?: TraktShow; movie?: TraktMovie }>> {
    return this.request(`/recommendations/${type}`);
  }

  // ===== User =====

  async getUserProfile(): Promise<{ username: string; private: boolean; name: string; vip: boolean; vip_ep: boolean; ids: { slug: string } }> {
    return this.request('/users/settings');
  }
}

/**
 * Create client from environment variables (for Vercel functions).
 */
export function createTraktClient(tokens?: TraktTokens): TraktClient {
  const clientId = process.env.TRAKT_CLIENT_ID!;
  const clientSecret = process.env.TRAKT_CLIENT_SECRET!;
  return new TraktClient(clientId, clientSecret, tokens);
}