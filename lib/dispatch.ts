import { db, type AppDb } from './db';
import {
  scheduledEmails,
  scheduledEmailRecipients,
  recipients,
  users,
  emailLogs,
  schedulerState,
} from './db/schema';
import { eq, and, lte, inArray, sql } from 'drizzle-orm';
import { defaultMailer, type Mailer } from './gmail';
import { nextOccurrence } from './recurrence';
import { attachmentContentForSchedule, purgeOrphanUploads } from './attachments';
import { TokenExpiredError } from './google';
import type { RecurrenceSpec, ScheduledEmail, Weekday } from './types';

/**
 * The send engine. Shared by the cron endpoint and by "Send now", so both
 * paths get the same duplicate protection and the same logging.
 */

export interface DispatchDeps {
  conn?: AppDb;
  mailer?: Mailer;
  now?: Date;
}

export interface DispatchResult {
  due: number;
  sent: number;
  failed: number;
  skippedDuplicates: number;
  skippedLocked: number;
  errors: string[];
}

export function specOf(row: ScheduledEmail): RecurrenceSpec {
  return {
    scheduleType: row.schedule_type,
    timezone: row.timezone,
    startDate: row.start_date ?? '',
    startTime: row.start_time ?? '00:00',
    repeatFrequency: row.repeat_frequency,
    repeatDays: row.repeat_days ? (JSON.parse(row.repeat_days) as Weekday[]) : null,
    repeatIntervalDays: row.repeat_interval_days,
    endDate: row.end_date,
  };
}

async function recipientsFor(
  conn: AppDb,
  scheduleId: number
): Promise<{ name: string; email: string }[]> {
  const rows = await conn
    .select({
      name: recipients.name,
      email: recipients.email,
    })
    .from(scheduledEmailRecipients)
    .innerJoin(recipients, eq(recipients.id, scheduledEmailRecipients.recipientId))
    .where(eq(scheduledEmailRecipients.scheduledEmailId, scheduleId))
    .orderBy(recipients.name);
  return rows;
}

async function senderAddress(conn: AppDb, userId: number): Promise<string> {
  const rows = await conn
    .select({
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row) throw new Error('The owner of this schedule no longer exists.');
  return row.name ? `${row.name} <${row.email}>` : row.email;
}

/**
 * Sends one occurrence of one schedule to every recipient.
 *
 * Duplicate protection: a row is inserted into email_logs keyed by
 * (schedule, recipient, occurrence) BEFORE the send. The unique index means a
 * second, overlapping scheduler run hits a constraint error and skips instead
 * of sending the same email twice.
 */
export async function sendOccurrence(
  schedule: ScheduledEmail,
  occurrenceKey: string,
  deps: DispatchDeps = {}
): Promise<{ sent: number; failed: number; skipped: number; errors: string[] }> {
  const conn = deps.conn ?? db();
  const mailer = deps.mailer ?? defaultMailer();
  const out = { sent: 0, failed: 0, skipped: 0, errors: [] as string[] };

  const recs = await recipientsFor(conn, schedule.id);
  if (recs.length === 0) {
    out.errors.push(`Schedule ${schedule.id} has no recipients left.`);
    return out;
  }

  const from = await senderAddress(conn, schedule.user_id);
  // Loaded once per occurrence, reused for every recipient.
  const rawAttachments = await attachmentContentForSchedule(schedule.id, conn);
  const attachments = rawAttachments.map((file) => ({
    filename: file.filename,
    mimeType: file.mime_type,
    content: file.content,
  }));

  for (const recipient of recs) {
    let logId: number;
    try {
      const inserted = await conn
        .insert(emailLogs)
        .values({
          scheduledEmailId: schedule.id,
          recipientEmail: recipient.email,
          occurrenceKey: occurrenceKey,
          status: 'pending',
        })
        .returning({ id: emailLogs.id });
      logId = inserted[0].id;
    } catch {
      out.skipped++; // already claimed by another run — do not resend
      continue;
    }

    try {
      console.log(
        `[SCHEDULER] Calling Gmail send for schedule ${schedule.id}, recipient #${logId}`
      );
      await mailer.send({
        userId: schedule.user_id,
        from,
        to: `${recipient.name} <${recipient.email}>`,
        subject: schedule.subject,
        body: schedule.body,
        attachments,
      });

      await conn
        .update(emailLogs)
        .set({ status: 'sent', sentAt: new Date().toISOString() })
        .where(eq(emailLogs.id, logId));

      out.sent++;
      console.log(
        `[SCHEDULER] Gmail send successful for schedule ${schedule.id}, log ${logId}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown send error';
      await conn
        .update(emailLogs)
        .set({
          status: 'failed',
          sentAt: new Date().toISOString(),
          errorMessage: message.slice(0, 500),
        })
        .where(eq(emailLogs.id, logId));

      out.failed++;
      out.errors.push(`${recipient.email}: ${message}`);
      console.error(`[SCHEDULER] Failed to process schedule: ${schedule.id}`);
      console.error(`[SCHEDULER] Error: ${message}`);
      if (err instanceof TokenExpiredError) break; // no point trying the rest
    }
  }
  return out;
}

/** Advances a schedule to its next occurrence, or closes it out. */
export async function advanceSchedule(
  schedule: ScheduledEmail,
  firedAt: Date,
  hadFailure: boolean,
  deps: DispatchDeps = {}
): Promise<void> {
  const conn = deps.conn ?? db();
  const next = schedule.schedule_type === 'repeat' ? nextOccurrence(specOf(schedule), firedAt) : null;

  if (next) {
    await conn
      .update(scheduledEmails)
      .set({
        nextSendAt: next.toISOString(),
        status: 'active',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(scheduledEmails.id, schedule.id));
    return;
  }

  await conn
    .update(scheduledEmails)
    .set({
      nextSendAt: null,
      status: hadFailure ? 'failed' : 'completed',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(scheduledEmails.id, schedule.id));
}

/** Heartbeat, so "is the scheduler even running?" is answerable from the UI. */
async function recordTick(conn: AppDb, now: Date, result: DispatchResult): Promise<void> {
  const nowIso = now.toISOString();
  // Upsert for row id = 1
  const existing = await conn
    .select({ id: schedulerState.id })
    .from(schedulerState)
    .where(eq(schedulerState.id, 1))
    .limit(1);

  if (existing.length > 0) {
    await conn
      .update(schedulerState)
      .set({
        lastRunAt: nowIso,
        lastDue: result.due,
        lastSent: result.sent,
        lastFailed: result.failed,
      })
      .where(eq(schedulerState.id, 1));
  } else {
    await conn.insert(schedulerState).values({
      id: 1,
      lastRunAt: nowIso,
      lastDue: result.due,
      lastSent: result.sent,
      lastFailed: result.failed,
    });
  }
}

/**
 * A claim older than this is assumed to belong to a crashed run and is released
 * so the schedule can fire again. Long enough that a slow Gmail call is never
 * treated as a crash.
 */
const STALE_CLAIM_MS = 10 * 60 * 1000;

async function releaseStaleClaims(conn: AppDb, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();

  const released = await conn
    .update(scheduledEmails)
    .set({
      status: sql`CASE WHEN ${scheduledEmails.scheduleType} = 'repeat' THEN 'active' ELSE 'scheduled' END`,
    })
    .where(and(eq(scheduledEmails.status, 'processing'), lte(scheduledEmails.updatedAt, cutoff)))
    .returning({ id: scheduledEmails.id });

  if (released.length > 0) {
    console.log(`[SCHEDULER] Released ${released.length} schedule(s) stuck in processing`);
  }
}

/**
 * Claims one occurrence for this run. The WHERE clause is the lock: only one
 * caller can move a row out of active/scheduled for a given next_send_at, so a
 * second overlapping cron invocation gets changes === 0 and walks away.
 */
async function claimSchedule(
  conn: AppDb,
  id: number,
  occurrenceKey: string,
  now: Date
): Promise<boolean> {
  const updated = await conn
    .update(scheduledEmails)
    .set({
      status: 'processing',
      updatedAt: now.toISOString(),
    })
    .where(
      and(
        eq(scheduledEmails.id, id),
        eq(scheduledEmails.nextSendAt, occurrenceKey),
        inArray(scheduledEmails.status, ['active', 'scheduled'])
      )
    )
    .returning({ id: scheduledEmails.id });

  return updated.length === 1;
}

/**
 * The whole scheduler tick. Called by GET/POST /api/cron/send-due.
 * Safe to run every minute; safe to run twice at once.
 */
export async function runDueSchedules(deps: DispatchDeps = {}): Promise<DispatchResult> {
  const conn = deps.conn ?? db();
  const now = deps.now ?? new Date();
  const result: DispatchResult = { due: 0, sent: 0, failed: 0, skippedDuplicates: 0, skippedLocked: 0, errors: [] };

  console.log(`[SCHEDULER] Checking for due schedules`);
  console.log(`[SCHEDULER] Current server time: ${now.toISOString()} (UTC)`);

  await releaseStaleClaims(conn, now);

  const rawRows = await conn
    .select()
    .from(scheduledEmails)
    .where(
      and(
        inArray(scheduledEmails.status, ['active', 'scheduled']),
        sql`${scheduledEmails.nextSendAt} IS NOT NULL`,
        lte(scheduledEmails.nextSendAt, now.toISOString())
      )
    )
    .orderBy(scheduledEmails.nextSendAt)
    .limit(200);

  const dueRows: ScheduledEmail[] = rawRows.map((r) => ({
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

  console.log(`[SCHEDULER] Found ${dueRows.length} due schedule(s)`);

  for (const schedule of dueRows) {
    const occurrenceKey = schedule.next_send_at as string;
    const firedAt = new Date(occurrenceKey);

    if (!(await claimSchedule(conn, schedule.id, occurrenceKey, now))) {
      result.skippedLocked++;
      console.log(`[SCHEDULER] Schedule ${schedule.id} already claimed by another run, skipping`);
      continue;
    }

    result.due++;
    console.log(`[SCHEDULER] Processing schedule: ${schedule.id} (due ${occurrenceKey})`);

    try {
      const attempt = await sendOccurrence(schedule, occurrenceKey, { ...deps, conn });
      result.sent += attempt.sent;
      result.failed += attempt.failed;
      result.skippedDuplicates += attempt.skipped;
      result.errors.push(...attempt.errors);

      await advanceSchedule(schedule, firedAt, attempt.failed > 0 && attempt.sent === 0, { ...deps, conn });

      const check = await conn
        .select({ status: scheduledEmails.status })
        .from(scheduledEmails)
        .where(eq(scheduledEmails.id, schedule.id))
        .limit(1);

      const finalStatus = check[0]?.status ?? 'unknown';
      console.log(
        `[SCHEDULER] Schedule ${schedule.id} marked as ${finalStatus} (sent=${attempt.sent} failed=${attempt.failed})`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown scheduler error';
      console.error(`[SCHEDULER] Failed to process schedule: ${schedule.id}`);
      console.error(`[SCHEDULER] Error: ${message}`);
      result.failed++;
      result.errors.push(`Schedule ${schedule.id}: ${message}`);
      await advanceSchedule(schedule, firedAt, true, { ...deps, conn });
    }
  }

  await purgeOrphanUploads(conn, now);
  await recordTick(conn, now, result);
  return result;
}
