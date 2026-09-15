import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import {
  scheduledEmails,
  scheduledEmailRecipients,
  recipients,
  emailLogs,
} from '@/lib/db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { currentUser } from '@/lib/session';
import { nextOccurrence } from '@/lib/recurrence';
import { specOf } from '@/lib/dispatch';
import { validateSchedule } from '@/lib/validate';
import type { ScheduledEmail } from '@/lib/types';
import {
  MAX_FILES_PER_EMAIL,
  MAX_TOTAL_BYTES,
  attachmentsForSchedule,
  formatBytes,
  linkAttachments,
  totalBytesOf,
  unlinkRemovedAttachments,
} from '@/lib/attachments';

export const runtime = 'nodejs';

type Params = { params: { id: string } };

async function load(userId: number, id: number): Promise<ScheduledEmail | undefined> {
  const rows = await db()
    .select()
    .from(scheduledEmails)
    .where(and(eq(scheduledEmails.id, id), eq(scheduledEmails.userId, userId)))
    .limit(1);

  const r = rows[0];
  if (!r) return undefined;
  return {
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
}

export async function GET(req: NextRequest, { params }: Params) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const row = await load(user.id, Number(params.id));
  if (!row) return NextResponse.json({ error: 'Schedule not found.' }, { status: 404 });

  const database = db();
  const recs = await database
    .select({
      id: recipients.id,
      name: recipients.name,
      email: recipients.email,
    })
    .from(scheduledEmailRecipients)
    .innerJoin(recipients, eq(recipients.id, scheduledEmailRecipients.recipientId))
    .where(eq(scheduledEmailRecipients.scheduledEmailId, row.id));

  const rawLogs = await database
    .select()
    .from(emailLogs)
    .where(eq(emailLogs.scheduledEmailId, row.id))
    .orderBy(desc(emailLogs.id))
    .limit(50);

  const logs = rawLogs.map((l) => ({
    id: l.id,
    scheduled_email_id: l.scheduledEmailId,
    recipient_email: l.recipientEmail,
    occurrence_key: l.occurrenceKey,
    sent_at: l.sentAt,
    status: l.status,
    error_message: l.errorMessage,
  }));

  const attachmentsList = await attachmentsForSchedule(row.id);

  return NextResponse.json({ schedule: row, recipients: recs, logs, attachments: attachmentsList });
}

/** PATCH { action: 'pause' | 'resume' } */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const row = await load(user.id, Number(params.id));
  if (!row) return NextResponse.json({ error: 'Schedule not found.' }, { status: 404 });

  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const database = db();

  if (action === 'pause') {
    if (!['active', 'scheduled'].includes(row.status)) {
      return NextResponse.json({ error: 'Only a running schedule can be paused.' }, { status: 400 });
    }
    await database
      .update(scheduledEmails)
      .set({ status: 'paused', updatedAt: new Date().toISOString() })
      .where(eq(scheduledEmails.id, row.id));
    return NextResponse.json({ ok: true, status: 'paused' });
  }

  if (action === 'resume') {
    if (row.status !== 'paused' && row.status !== 'failed') {
      return NextResponse.json({ error: 'Only a paused or failed schedule can be resumed.' }, { status: 400 });
    }
    const next = nextOccurrence(specOf(row), new Date());
    if (!next) {
      await database
        .update(scheduledEmails)
        .set({ status: 'completed', nextSendAt: null, updatedAt: new Date().toISOString() })
        .where(eq(scheduledEmails.id, row.id));
      return NextResponse.json({ ok: true, status: 'completed', message: 'No occurrences left, so this is now complete.' });
    }
    const status = row.schedule_type === 'repeat' ? 'active' : 'scheduled';
    await database
      .update(scheduledEmails)
      .set({ status, nextSendAt: next.toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(scheduledEmails.id, row.id));
    return NextResponse.json({ ok: true, status, nextSendAt: next.toISOString() });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}

/** PUT replaces subject, body, recipients and timing. */
export async function PUT(req: NextRequest, { params }: Params) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const row = await load(user.id, Number(params.id));
  if (!row) return NextResponse.json({ error: 'Schedule not found.' }, { status: 404 });

  const parsedBody = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = validateSchedule(parsedBody);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;

  const rawIds = parsedBody?.attachmentIds;
  const attachmentIds = Array.isArray(rawIds)
    ? [...new Set(rawIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : null;

  if (attachmentIds) {
    if (attachmentIds.length > MAX_FILES_PER_EMAIL) {
      return NextResponse.json(
        { error: `You can attach up to ${MAX_FILES_PER_EMAIL} files to one email.` },
        { status: 400 }
      );
    }
    const total = await totalBytesOf(user.id, attachmentIds);
    if (total > MAX_TOTAL_BYTES) {
      return NextResponse.json(
        { error: `Those attachments total ${formatBytes(total)}. The limit is ${formatBytes(MAX_TOTAL_BYTES)} per email.` },
        { status: 400 }
      );
    }
  }
  if (input.scheduleType === 'now') {
    return NextResponse.json({ error: 'Use Compose to send an email immediately.' }, { status: 400 });
  }

  const database = db();
  const ownedRows = await database
    .select({ id: recipients.id })
    .from(recipients)
    .where(and(eq(recipients.userId, user.id), inArray(recipients.id, input.recipientIds)));

  const owned = ownedRows.map((r) => r.id);
  if (owned.length !== input.recipientIds.length) {
    return NextResponse.json({ error: 'One or more recipients could not be found.' }, { status: 400 });
  }

  const next = nextOccurrence(
    {
      scheduleType: input.scheduleType,
      timezone: input.timezone,
      startDate: input.startDate,
      startTime: input.startTime,
      repeatFrequency: input.repeatFrequency,
      repeatDays: input.repeatDays,
      repeatIntervalDays: input.repeatIntervalDays,
      endDate: input.endDate,
    },
    new Date(Date.now() - 1000)
  );
  if (!next) return NextResponse.json({ error: 'That pattern has no future send dates.' }, { status: 400 });

  await database
    .update(scheduledEmails)
    .set({
      subject: input.subject,
      body: input.body,
      scheduleType: input.scheduleType,
      scheduledAt: input.scheduleType === 'repeat' ? null : next.toISOString(),
      timezone: input.timezone,
      repeatFrequency: input.repeatFrequency,
      repeatDays: input.repeatDays ? JSON.stringify(input.repeatDays) : null,
      repeatIntervalDays: input.repeatIntervalDays,
      startDate: input.startDate,
      startTime: input.startTime,
      endDate: input.endDate,
      nextSendAt: next.toISOString(),
      status: input.scheduleType === 'repeat' ? 'active' : 'scheduled',
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(scheduledEmails.id, row.id), eq(scheduledEmails.userId, user.id)));

  await database
    .delete(scheduledEmailRecipients)
    .where(eq(scheduledEmailRecipients.scheduledEmailId, row.id));

  for (const recId of owned) {
    await database.insert(scheduledEmailRecipients).values({
      scheduledEmailId: row.id,
      recipientId: recId,
    });
  }

  if (attachmentIds) {
    await linkAttachments(user.id, row.id, attachmentIds);
    await unlinkRemovedAttachments(row.id, attachmentIds);
  }

  return NextResponse.json({ ok: true, nextSendAt: next.toISOString() });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const deleted = await db()
    .delete(scheduledEmails)
    .where(and(eq(scheduledEmails.id, Number(params.id)), eq(scheduledEmails.userId, user.id)))
    .returning({ id: scheduledEmails.id });

  if (deleted.length === 0) return NextResponse.json({ error: 'Schedule not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
