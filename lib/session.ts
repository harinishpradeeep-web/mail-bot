import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { db } from './db';
import { users } from './db/schema';
import { eq } from 'drizzle-orm';
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
export async function currentUser(req: NextRequest): Promise<User | null> {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const id = unsign(raw);
  if (!id) return null;

  const rows = await db()
    .select({
      id: users.id,
      google_id: users.googleId,
      email: users.email,
      name: users.name,
      gmail_connected: users.gmailConnected,
      created_at: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, Number(id)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    google_id: row.google_id,
    email: row.email,
    name: row.name,
    gmail_connected: (row.gmail_connected ?? 0) as 0 | 1,
    created_at: row.created_at,
  };
}
