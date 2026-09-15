import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/session';
import { db } from '@/lib/db';
import { recipients, scheduledEmails, emailLogs, schedulerState } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { isGoogleConfigured } from '@/lib/google';

export const runtime = 'nodejs';

/**
 * What the frontend is allowed to know about the connection: the account
 * address and a boolean. No tokens, no client id, no secret.
 */
export async function GET(req: NextRequest) {
  const user = await currentUser(req);
  const googleConfigured = isGoogleConfigured();

  if (!user) return NextResponse.json({ signedIn: false, googleConfigured });

  const database = db();

  const recipientList = await database
    .select({ id: recipients.id })
    .from(recipients)
    .where(eq(recipients.userId, user.id));

  const scheduledList = await database
    .select({ id: scheduledEmails.id })
    .from(scheduledEmails)
    .where(
      and(
        eq(scheduledEmails.userId, user.id),
        inArray(scheduledEmails.status, ['active', 'scheduled', 'paused'])
      )
    );

  const recurringList = await database
    .select({ id: scheduledEmails.id })
    .from(scheduledEmails)
    .where(
      and(
        eq(scheduledEmails.userId, user.id),
        eq(scheduledEmails.status, 'active'),
        eq(scheduledEmails.scheduleType, 'repeat')
      )
    );

  const sentLogs = await database
    .select({ id: emailLogs.id })
    .from(emailLogs)
    .innerJoin(scheduledEmails, eq(scheduledEmails.id, emailLogs.scheduledEmailId))
    .where(
      and(
        eq(scheduledEmails.userId, user.id),
        eq(emailLogs.status, 'sent')
      )
    );

  const counts = {
    recipients: recipientList.length,
    scheduled: scheduledList.length,
    recurring: recurringList.length,
    sent: sentLogs.length,
  };

  const ticks = await database
    .select({
      last_run_at: schedulerState.lastRunAt,
      last_due: schedulerState.lastDue,
      last_sent: schedulerState.lastSent,
      last_failed: schedulerState.lastFailed,
    })
    .from(schedulerState)
    .where(eq(schedulerState.id, 1))
    .limit(1);

  const tick = ticks[0];

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
