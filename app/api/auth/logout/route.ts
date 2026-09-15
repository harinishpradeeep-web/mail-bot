import { NextResponse, type NextRequest } from 'next/server';
import { clearSession, currentUser } from '@/lib/session';
import { disconnectGmail } from '@/lib/google';

export const runtime = 'nodejs';

/** POST { revoke: true } also wipes the stored Gmail tokens. */
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  const body = (await req.json().catch(() => ({}))) as { revoke?: boolean };
  if (user && body.revoke) await disconnectGmail(user.id);

  const res = NextResponse.json({ ok: true });
  clearSession(res);
  return res;
}
