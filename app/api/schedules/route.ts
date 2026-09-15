import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import {
  scheduledEmails,
  scheduledEmailRecipients,
  recipients,
} from '@/lib/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
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

async function listSchedules(userId: number) {
  const database = db();
  const rawRows = await database
    .select()
    .from(scheduledEmails)
    .where(eq(scheduledEmails.userId, userId))
    .orderBy(
      sql`CASE WHEN ${scheduledEmails.nextSendAt} IS NULL THEN 1 ELSE 0 END`,
      scheduledEmails.nextSendAt,
      sql`${scheduledEmails.createdAt} DESC`
    );

  const rows: ScheduledEmail[] = rawRows.map((r) => ({
    id: r.id,
    user_id: r.userId,
    subject: r.subject,
    body: r.body,
    schedule_type: r.scheduleType as ScheduledEmail['schedule_type'],
    scheduled_at: r.scheduledAt,
    timezone: r.timezone,
    repeat_frequency: r.repeatFrequency as ScheduledEmail['repeat_frequency'],
    repeat_days: r.repeatDays,
    repeat_interval_days: r.repeatIntervalDays,
    start_date: r.startDate,
    start_time: r.startTime,
    end_date: r.endDate,
    next_send_at: r.nextSendAt,
    status: r.status as ScheduledEmail['status'],
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));

  const results = [];
  for (const row of rows) {
    const recRows = await database
      .select({
        id: recipients.id,
        name: recipients.name,
        email: recipients.email,
      })
      .from(scheduledEmailRecipients)
      .innerJoin(recipients, eq(recipients.id, scheduledEmailRecipients.recipientId))
      .where(eq(scheduledEmailRecipients.scheduledEmailId, row.id))
      .orderBy(recipients.name);

    const attachmentsList = await attachmentsForSchedule(row.id);

    results.push({
      ...row,
      recipients: recRows,
      attachments: attachmentsList,
      scheduleLabel: describeSchedule(specOf(row)),
    });
  }

  return results;
}

export async function GET(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
  const schedules = await listSchedules(user.id);
  return NextResponse.json({ schedules });
}

export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
  if (user.gmail_connected !== 1) {
    return NextResponse.json({ error: 'Connect Gmail before scheduling emails.' }, { status: 400 });
  }

  const parsedBody = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = validateSchedule(parsedBody);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;

  const database = db();

  const ownedRows = await database
    .select({ id: recipients.id })
    .from(recipients)
    .where(and(eq(recipients.userId, user.id), inArray(recipients.id, input.recipientIds)));

  const ownedIds = ownedRows.map((r) => r.id);

  if (ownedIds.length !== input.recipientIds.length) {
    return NextResponse.json({ error: 'One or more recipients could not be found.' }, { status: 400 });
  }

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
    const total = await totalBytesOf(user.id, attachmentIds);
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

  const inserted = await database
    .insert(scheduledEmails)
    .values({
      userId: user.id,
      subject: input.subject,
      body: input.body,
      scheduleType: input.scheduleType,
      scheduledAt: input.scheduleType === 'repeat' ? null : firstSend.toISOString(),
      timezone: input.timezone,
      repeatFrequency: input.repeatFrequency,
      repeatDays: input.repeatDays ? JSON.stringify(input.repeatDays) : null,
      repeatIntervalDays: input.repeatIntervalDays,
      startDate: input.startDate,
      startTime: input.startTime,
      endDate: input.endDate,
      nextSendAt: firstSend.toISOString(),
      status: status,
    })
    .returning({ id: scheduledEmails.id });

  const scheduleId = inserted[0].id;

  for (const recId of ownedIds) {
    await database.insert(scheduledEmailRecipients).values({
      scheduledEmailId: scheduleId,
      recipientId: recId,
    });
  }

  if (attachmentIds.length > 0) await linkAttachments(user.id, scheduleId, attachmentIds);

  if (input.scheduleType === 'now') {
    const rawRow = await database
      .select()
      .from(scheduledEmails)
      .where(eq(scheduledEmails.id, scheduleId))
      .limit(1);

    const r = rawRow[0];
    const row: ScheduledEmail = {
      id: r.id,
      user_id: r.userId,
      subject: r.subject,
      body: r.body,
      schedule_type: r.scheduleType as ScheduledEmail['schedule_type'],
      scheduled_at: r.scheduledAt,
      timezone: r.timezone,
      repeat_frequency: r.repeatFrequency as ScheduledEmail['repeat_frequency'],
      repeat_days: r.repeatDays,
      repeat_interval_days: r.repeatIntervalDays,
      start_date: r.startDate,
      start_time: r.startTime,
      end_date: r.endDate,
      next_send_at: r.nextSendAt,
      status: r.status as ScheduledEmail['status'],
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    };

    const attempt = await sendOccurrence(row, firstSend.toISOString());
    await advanceSchedule(row, firstSend, attempt.failed > 0 && attempt.sent === 0);
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
