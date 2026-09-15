import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/session';
import { db } from '@/lib/db';
import { isGoogleConfigured } from '@/lib/google';

export const runtime = 'nodejs';

/**
 * What the frontend is allowed to know about the connection: the account
 * address and a boolean. No tokens, no client id, no secret.
 */
export function GET(req: NextRequest) {
  const user = currentUser(req);
  const googleConfigured = isGoogleConfigured();

  if (!user) return NextResponse.json({ signedIn: false, googleConfigured });

  const counts = db()
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM recipients WHERE user_id = @id) AS recipients,
        (SELECT COUNT(*) FROM scheduled_emails WHERE user_id = @id AND status IN ('active','scheduled','paused')) AS scheduled,
        (SELECT COUNT(*) FROM scheduled_emails WHERE user_id = @id AND status = 'active' AND schedule_type = 'repeat') AS recurring,
        (SELECT COUNT(*) FROM email_logs l JOIN scheduled_emails s ON s.id = l.scheduled_email_id
          WHERE s.user_id = @id AND l.status = 'sent') AS sent`
    )
    .get({ id: user.id }) as { recipients: number; scheduled: number; recurring: number; sent: number };

  const tick = db()
    .prepare('SELECT last_run_at, last_due, last_sent, last_failed FROM scheduler_state WHERE id = 1')
    .get() as { last_run_at: string; last_due: number; last_sent: number; last_failed: number } | undefined;

  return NextResponse.json({
    signedIn: true,
    googleConfigured,
    scheduler: tick
      ? { lastRunAt: tick.last_run_at, lastDue: tick.last_due, lastSent: tick.last_sent, lastFailed: tick.last_failed }
      : null,
    user: {
      email: user.email,
      name: user.name,
      gmailConnected: user.gmail_connected === 1,
    },
    counts,
  });
}
