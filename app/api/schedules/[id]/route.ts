import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
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

function load(userId: number, id: number): ScheduledEmail | undefined {
  return db().prepare('SELECT * FROM scheduled_emails WHERE id = ? AND user_id = ?').get(id, userId) as
    | ScheduledEmail
    | undefined;
}

export function GET(req: NextRequest, { params }: Params) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const row = load(user.id, Number(params.id));
  if (!row) return NextResponse.json({ error: 'Schedule not found.' }, { status: 404 });

  const recipients = db()
    .prepare(
      `SELECT r.id, r.name, r.email FROM scheduled_email_recipients ser
       JOIN recipients r ON r.id = ser.recipient_id WHERE ser.scheduled_email_id = ?`
    )
    .all(row.id);
  const logs = db()
    .prepare('SELECT * FROM email_logs WHERE scheduled_email_id = ? ORDER BY id DESC LIMIT 50')
    .all(row.id);

  return NextResponse.json({ schedule: row, recipients, logs, attachments: attachmentsForSchedule(row.id) });
}

/** PATCH { action: 'pause' | 'resume' } */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const row = load(user.id, Number(params.id));
  if (!row) return NextResponse.json({ error: 'Schedule not found.' }, { status: 404 });

  const { action } = (await req.json().catch(() => ({}))) as { action?: string };

  if (action === 'pause') {
    if (!['active', 'scheduled'].includes(row.status)) {
      return NextResponse.json({ error: 'Only a running schedule can be paused.' }, { status: 400 });
    }
    db()
      .prepare(`UPDATE scheduled_emails SET status = 'paused', updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), row.id);
    return NextResponse.json({ ok: true, status: 'paused' });
  }

  if (action === 'resume') {
    if (row.status !== 'paused' && row.status !== 'failed') {
      return NextResponse.json({ error: 'Only a paused or failed schedule can be resumed.' }, { status: 400 });
    }
    // Skip anything that came due while paused rather than firing a burst.
    const next = nextOccurrence(specOf(row), new Date());
    if (!next) {
      db()
        .prepare(`UPDATE scheduled_emails SET status = 'completed', next_send_at = NULL, updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), row.id);
      return NextResponse.json({ ok: true, status: 'completed', message: 'No occurrences left, so this is now complete.' });
    }
    const status = row.schedule_type === 'repeat' ? 'active' : 'scheduled';
    db()
      .prepare('UPDATE scheduled_emails SET status = ?, next_send_at = ?, updated_at = ? WHERE id = ?')
      .run(status, next.toISOString(), new Date().toISOString(), row.id);
    return NextResponse.json({ ok: true, status, nextSendAt: next.toISOString() });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}

/** PUT replaces subject, body, recipients and timing. */
export async function PUT(req: NextRequest, { params }: Params) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const row = load(user.id, Number(params.id));
  if (!row) return NextResponse.json({ error: 'Schedule not found.' }, { status: 404 });

  const parsedBody = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = validateSchedule(parsedBody);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;

  // Absent attachmentIds means "leave the attachments alone"; an array
  // replaces the set, so removing one in the composer removes it here.
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
    const total = totalBytesOf(user.id, attachmentIds);
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

  const placeholders = input.recipientIds.map(() => '?').join(',');
  const owned = (
    db()
      .prepare(`SELECT id FROM recipients WHERE user_id = ? AND id IN (${placeholders})`)
      .all(user.id, ...input.recipientIds) as { id: number }[]
  ).map((r) => r.id);
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

  db()
    .prepare(
      `UPDATE scheduled_emails SET subject=?, body=?, schedule_type=?, scheduled_at=?, timezone=?,
        repeat_frequency=?, repeat_days=?, repeat_interval_days=?, start_date=?, start_time=?, end_date=?,
        next_send_at=?, status=?, updated_at=? WHERE id=? AND user_id=?`
    )
    .run(
      input.subject,
      input.body,
      input.scheduleType,
      input.scheduleType === 'repeat' ? null : next.toISOString(),
      input.timezone,
      input.repeatFrequency,
      input.repeatDays ? JSON.stringify(input.repeatDays) : null,
      input.repeatIntervalDays,
      input.startDate,
      input.startTime,
      input.endDate,
      next.toISOString(),
      input.scheduleType === 'repeat' ? 'active' : 'scheduled',
      new Date().toISOString(),
      row.id,
      user.id
    );

  db().prepare('DELETE FROM scheduled_email_recipients WHERE scheduled_email_id = ?').run(row.id);
  const link = db().prepare('INSERT INTO scheduled_email_recipients (scheduled_email_id, recipient_id) VALUES (?,?)');
  for (const id of owned) link.run(row.id, id);

  if (attachmentIds) {
    linkAttachments(user.id, row.id, attachmentIds);
    unlinkRemovedAttachments(row.id, attachmentIds);
  }

  return NextResponse.json({ ok: true, nextSendAt: next.toISOString() });
}

export function DELETE(req: NextRequest, { params }: Params) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const info = db().prepare('DELETE FROM scheduled_emails WHERE id = ? AND user_id = ?').run(Number(params.id), user.id);
  if (info.changes === 0) return NextResponse.json({ error: 'Schedule not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
