import { db } from './db';
import { decryptSecret, encryptSecret } from './crypto';

/**
 * Google OAuth 2.0 — server side only.
 *
 * The client secret and the tokens never leave this process: the frontend only
 * ever sees the redirect URL produced by authUrl() and the boolean
 * "gmail_connected".
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

/**
 * gmail.send is the narrowest scope that can send mail — it grants no read
 * access to the mailbox at all. openid/email/profile identify the account.
 */
export const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.send',
];

function config() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    // ⬇️ YOU MUST FILL THESE IN — see GMAIL_SETUP.md and .env.example
    throw new Error(
      'Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI in .env (see GMAIL_SETUP.md).'
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

export function authUrl(state: string): string {
  const { clientId, redirectUri } = config();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    // offline + consent is what gets us a refresh_token, which is what lets
    // the scheduler send while the user is away.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret, redirectUri } = config();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    // Body may echo credentials back; log only the status.
    throw new Error(`Google rejected the authorisation code (HTTP ${res.status}).`);
  }
  return (await res.json()) as TokenResponse;
}

export async function fetchProfile(accessToken: string): Promise<{ sub: string; email: string; name?: string }> {
  const res = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Could not read the Google profile (HTTP ${res.status}).`);
  return (await res.json()) as { sub: string; email: string; name?: string };
}

export function saveTokens(
  userId: number,
  tokens: { access_token: string; refresh_token?: string; expires_in: number }
): void {
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString();
  if (tokens.refresh_token) {
    db()
      .prepare(
        `UPDATE users SET access_token = ?, refresh_token = ?, token_expires_at = ?, gmail_connected = 1 WHERE id = ?`
      )
      .run(encryptSecret(tokens.access_token), encryptSecret(tokens.refresh_token), expiresAt, userId);
  } else {
    // Google only returns refresh_token on first consent; keep the stored one.
    db()
      .prepare(`UPDATE users SET access_token = ?, token_expires_at = ?, gmail_connected = 1 WHERE id = ?`)
      .run(encryptSecret(tokens.access_token), expiresAt, userId);
  }
}

export function disconnectGmail(userId: number): void {
  db()
    .prepare(
      `UPDATE users SET access_token = NULL, refresh_token = NULL, token_expires_at = NULL, gmail_connected = 0 WHERE id = ?`
    )
    .run(userId);
}

export class TokenExpiredError extends Error {
  constructor(message = 'The Gmail connection has expired. Reconnect Gmail in Settings.') {
    super(message);
    this.name = 'TokenExpiredError';
  }
}

/** Returns a usable access token, refreshing it first if it is close to expiry. */
export async function getAccessToken(userId: number): Promise<string> {
  const row = db()
    .prepare('SELECT access_token, refresh_token, token_expires_at FROM users WHERE id = ?')
    .get(userId) as { access_token: string | null; refresh_token: string | null; token_expires_at: string | null } | undefined;

  if (!row || !row.refresh_token) throw new TokenExpiredError('Gmail is not connected for this account.');

  if (row.access_token && row.token_expires_at && new Date(row.token_expires_at) > new Date()) {
    return decryptSecret(row.access_token);
  }

  const { clientId, clientSecret } = config();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptSecret(row.refresh_token),
      grant_type: 'refresh_token',
    }),
  });

  if (res.status === 400 || res.status === 401) {
    // Refresh token revoked or expired: force a reconnect instead of retrying.
    disconnectGmail(userId);
    throw new TokenExpiredError();
  }
  if (!res.ok) throw new Error(`Could not refresh the Google access token (HTTP ${res.status}).`);

  const tokens = (await res.json()) as TokenResponse;
  saveTokens(userId, tokens);
  return tokens.access_token;
}
