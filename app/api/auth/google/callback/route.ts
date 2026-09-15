import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
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

    const database = db();
    const existingList = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.googleId, profile.sub))
      .limit(1);

    let userId: number;
    if (existingList.length > 0) {
      userId = existingList[0].id;
      await database
        .update(users)
        .set({ email: profile.email, name: profile.name ?? '' })
        .where(eq(users.id, userId));
    } else {
      const inserted = await database
        .insert(users)
        .values({
          googleId: profile.sub,
          email: profile.email,
          name: profile.name ?? '',
        })
        .returning({ id: users.id });
      userId = inserted[0].id;
    }

    await saveTokens(userId, tokens);

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
