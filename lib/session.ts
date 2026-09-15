import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { db } from './db';
import { sign, unsign } from './crypto';
import type { User } from './types';

export const SESSION_COOKIE = 'ms_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function setSession(res: NextResponse, userId: number): void {
  res.cookies.set(SESSION_COOKIE, sign(String(userId)), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearSession(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

/**
 * Resolves the signed-in user from the session cookie.
 * Every data route calls this and scopes its queries by user_id, so one
 * user can never read or mutate another user's rows.
 */
export function currentUser(req: NextRequest): User | null {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const id = unsign(raw);
  if (!id) return null;
  const row = db()
    .prepare('SELECT id, google_id, email, name, gmail_connected, created_at FROM users WHERE id = ?')
    .get(Number(id)) as User | undefined;
  return row ?? null;
}
