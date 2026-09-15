import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { validateSchedule } from '@/lib/validate';
import { describeSchedule, firstOccurrence } from '@/lib/recurrence';
import { advanceSchedule, sendOccurrence, specOf } from '@/lib/dispatch';
import type { ScheduledEmail } from '@/lib/types';
import {
  MAX_FILES_PER_EMAIL,
  MAX_TOTAL_BYTES,
  attachmentsForSchedule,
  formatBytes,
  linkAttachments,
  totalBytesOf,
} from '@/lib/attachments';

export const runtime = 'nodejs';

function listSchedules(userId: number) {
  const rows = db()
    .prepare(
      `SELECT * FROM scheduled_emails WHERE user_id = ?
       ORDER BY CASE WHEN next_send_at IS NULL THEN 1 ELSE 0 END, next_send_at, created_at DESC`
    )
    .all(userId) as ScheduledEmail[];

  const recipientsStmt = db().prepare(
    `SELECT r.id, r.name, r.email FROM scheduled_email_recipients ser
     JOIN recipients r ON r.id = ser.recipient_id
     WHERE ser.scheduled_email_id = ? ORDER BY r.name`
  );

  return rows.map((row) => ({
    ...row,
    recipients: recipientsStmt.all(row.id) as { id: number; name: string; email: string }[],
    attachments: attachmentsForSchedule(row.id),
    scheduleLabel: describeSchedule(specOf(row)),
  }));
}

export function GET(req: NextRequest) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
  return NextResponse.json({ schedules: listSchedules(user.id) });
}

export async function POST(req: NextRequest) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
  if (user.gmail_connected !== 1) {
    return NextResponse.json({ error: 'Connect Gmail before scheduling emails.' }, { status: 400 });
  }

  const parsedBody = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = validateSchedule(parsedBody);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;

  // Authorisation: recipients must belong to this user.
  const placeholders = input.recipientIds.map(() => '?').join(',');
  const ownedIds = (
    db()
      .prepare(`SELECT id FROM recipients WHERE user_id = ? AND id IN (${placeholders})`)
      .all(user.id, ...input.recipientIds) as { id: number }[]
  ).map((r) => r.id);

  if (ownedIds.length !== input.recipientIds.length) {
    return NextResponse.json({ error: 'One or more recipients could not be found.' }, { status: 400 });
  }

  // Attachments are optional: an email without them behaves exactly as before.
  const rawIds = parsedBody?.attachmentIds;
  const attachmentIds = Array.isArray(rawIds)
    ? [...new Set(rawIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : [];

  if (attachmentIds.length > MAX_FILES_PER_EMAIL) {
    return NextResponse.json(
      { error: `You can attach up to ${MAX_FILES_PER_EMAIL} files to one email.` },
      { status: 400 }
    );
  }
  if (attachmentIds.length > 0) {
    const total = totalBytesOf(user.id, attachmentIds);
    if (total > MAX_TOTAL_BYTES) {
      return NextResponse.json(
        { error: `Those attachments total ${formatBytes(total)}. The limit is ${formatBytes(MAX_TOTAL_BYTES)} per email.` },
        { status: 400 }
      );
    }
  }

  const spec = {
    scheduleType: input.scheduleType,
    timezone: input.timezone,
    startDate: input.startDate,
    startTime: input.startTime,
    repeatFrequency: input.repeatFrequency,
    repeatDays: input.repeatDays,
    repeatIntervalDays: input.repeatIntervalDays,
    endDate: input.endDate,
  };

  const now = new Date();
  const firstSend = input.scheduleType === 'now' ? now : firstOccurrence(spec, now);
  if (!firstSend) {
    return NextResponse.json(
      { error: 'That pattern has no send dates. Check the start date, days and end date.' },
      { status: 400 }
    );
  }

  const status = input.scheduleType === 'repeat' ? 'active' : 'scheduled';

  const scheduleId = Number(
    db()
      .prepare(
        `INSERT INTO scheduled_emails
          (user_id, subject, body, schedule_type, scheduled_at, timezone, repeat_frequency, repeat_days,
           repeat_interval_days, start_date, start_time, end_date, next_send_at, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        user.id,
        input.subject,
        input.body,
        input.scheduleType,
        input.scheduleType === 'repeat' ? null : firstSend.toISOString(),
        input.timezone,
        input.repeatFrequency,
        input.repeatDays ? JSON.stringify(input.repeatDays) : null,
        input.repeatIntervalDays,
        input.startDate,
        input.startTime,
        input.endDate,
        firstSend.toISOString(),
        status
      ).lastInsertRowid
  );

  const link = db().prepare('INSERT INTO scheduled_email_recipients (scheduled_email_id, recipient_id) VALUES (?, ?)');
  for (const id of ownedIds) link.run(scheduleId, id);

  // Binds only rows this user owns; unknown ids are silently not claimed.
  if (attachmentIds.length > 0) linkAttachments(user.id, scheduleId, attachmentIds);

  // "Send now" goes through the same engine as the cron job, so it gets the
  // same logging and duplicate protection.
  if (input.scheduleType === 'now') {
    const row = db().prepare('SELECT * FROM scheduled_emails WHERE id = ?').get(scheduleId) as ScheduledEmail;
    const attempt = await sendOccurrence(row, firstSend.toISOString());
    advanceSchedule(row, firstSend, attempt.failed > 0 && attempt.sent === 0);
    return NextResponse.json(
      {
        id: scheduleId,
        sent: attempt.sent,
        failed: attempt.failed,
        error: attempt.errors[0] ?? null,
      },
      { status: attempt.failed > 0 && attempt.sent === 0 ? 502 : 201 }
    );
  }

  return NextResponse.json({ id: scheduleId, nextSendAt: firstSend.toISOString() }, { status: 201 });
}
