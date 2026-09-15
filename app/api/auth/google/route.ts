import { NextResponse, type NextRequest } from 'next/server';
import { authUrl, isGoogleConfigured } from '@/lib/google';
import { randomToken, sign } from '@/lib/crypto';

export const runtime = 'nodejs';
// Must run per-request: each attempt mints a fresh CSRF state cookie.
export const dynamic = 'force-dynamic';

/** Starts the OAuth flow. Signing in and connecting Gmail are one step. */
export function GET(_req: NextRequest) {
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(
      new URL('/settings?error=google_not_configured', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000')
    );
  }

  // CSRF guard: the state we send must come back in the callback.
  const state = randomToken(24);
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set('ms_oauth_state', sign(state), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  console.log("OAuth redirect URI:", process.env.GOOGLE_REDIRECT_URI);
  console.log("Google client ID:", process.env.GOOGLE_CLIENT_ID);
  return res;
}
