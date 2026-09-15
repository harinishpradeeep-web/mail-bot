import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { exchangeCode, fetchProfile, saveTokens } from '@/lib/google';
import { setSession } from '@/lib/session';
import { unsign } from '@/lib/crypto';

export const runtime = 'nodejs';

/**
 * Google redirects here after consent. This route is the value you must
 * register as an "Authorised redirect URI" in Google Cloud Console and set as
 * GOOGLE_REDIRECT_URI:
 *   http://localhost:3000/api/auth/google/callback
 */
export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const denied = url.searchParams.get('error');

  const fail = (reason: string) => NextResponse.redirect(new URL(`/settings?error=${reason}`, base));

  // The user pressed "Cancel" on the Google consent screen.
  if (denied) return fail('access_denied');
  if (!code || !state) return fail('missing_code');

  const cookieState = req.cookies.get('ms_oauth_state')?.value;
  if (!cookieState || unsign(cookieState) !== state) return fail('state_mismatch');

  try {
    const tokens = await exchangeCode(code);
    const profile = await fetchProfile(tokens.access_token);

    const existing = db().prepare('SELECT id FROM users WHERE google_id = ?').get(profile.sub) as
      | { id: number }
      | undefined;

    let userId: number;
    if (existing) {
      userId = existing.id;
      db().prepare('UPDATE users SET email = ?, name = ? WHERE id = ?').run(profile.email, profile.name ?? '', userId);
    } else {
      userId = Number(
        db()
          .prepare('INSERT INTO users (google_id, email, name) VALUES (?, ?, ?)')
          .run(profile.sub, profile.email, profile.name ?? '').lastInsertRowid
      );
    }

    saveTokens(userId, tokens);

    const res = NextResponse.redirect(new URL('/?connected=1', base));
    setSession(res, userId);
    res.cookies.set('ms_oauth_state', '', { path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    // Log the message only — never the code, tokens or client secret.
    console.error('OAuth callback failed:', err instanceof Error ? err.message : 'unknown error');
    return fail('oauth_failed');
  }
}
