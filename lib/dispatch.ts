import type BetterSqlite3 from 'better-sqlite3';
import { db } from './db';
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
  conn?: BetterSqlite3.Database;
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

function recipientsFor(conn: BetterSqlite3.Database, scheduleId: number): { name: string; email: string }[] {
  return conn
    .prepare(
      `SELECT r.name, r.email FROM scheduled_email_recipients ser
       JOIN recipients r ON r.id = ser.recipient_id
       WHERE ser.scheduled_email_id = ? ORDER BY r.name`
    )
    .all(scheduleId) as { name: string; email: string }[];
}

function senderAddress(conn: BetterSqlite3.Database, userId: number): string {
  const row = conn.prepare('SELECT email, name FROM users WHERE id = ?').get(userId) as
    | { email: string; name: string }
    | undefined;
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

  const recipients = recipientsFor(conn, schedule.id);
  if (recipients.length === 0) {
    out.errors.push(`Schedule ${schedule.id} has no recipients left.`);
    return out;
  }

  const from = senderAddress(conn, schedule.user_id);
  // Loaded once per occurrence, reused for every recipient.
  const attachments = attachmentContentForSchedule(schedule.id, conn).map((file) => ({
    filename: file.filename,
    mimeType: file.mime_type,
    content: file.content,
  }));
  const claim = conn.prepare(
    `INSERT INTO email_logs (scheduled_email_id, recipient_email, occurrence_key, status)
     VALUES (?, ?, ?, 'pending')`
  );

  for (const recipient of recipients) {
    let logId: number;
    try {
      logId = Number(claim.run(schedule.id, recipient.email, occurrenceKey).lastInsertRowid);
    } catch {
      out.skipped++; // already claimed by another run — do not resend
      continue;
    }

    try {
      console.log(`[SCHEDULER] Calling Gmail send for schedule ${schedule.id}, recipient #${logId}`);
      await mailer.send({
        userId: schedule.user_id,
        from,
        to: `${recipient.name} <${recipient.email}>`,
        subject: schedule.subject,
        body: schedule.body,
        attachments,
      });
      conn
        .prepare(`UPDATE email_logs SET status = 'sent', sent_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), logId);
      out.sent++;
      console.log(`[SCHEDULER] Gmail send successful for schedule ${schedule.id}, log ${logId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown send error';
      conn
        .prepare(`UPDATE email_logs SET status = 'failed', sent_at = ?, error_message = ? WHERE id = ?`)
        .run(new Date().toISOString(), message.slice(0, 500), logId);
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
export function advanceSchedule(
  schedule: ScheduledEmail,
  firedAt: Date,
  hadFailure: boolean,
  deps: DispatchDeps = {}
): void {
  const conn = deps.conn ?? db();
  const next = schedule.schedule_type === 'repeat' ? nextOccurrence(specOf(schedule), firedAt) : null;

  if (next) {
    conn
      .prepare(
        `UPDATE scheduled_emails SET next_send_at = ?, status = 'active', updated_at = ? WHERE id = ?`
      )
      .run(next.toISOString(), new Date().toISOString(), schedule.id);
    return;
  }

  conn
    .prepare(`UPDATE scheduled_emails SET next_send_at = NULL, status = ?, updated_at = ? WHERE id = ?`)
    .run(hadFailure ? 'failed' : 'completed', new Date().toISOString(), schedule.id);
}

/** Heartbeat, so "is the scheduler even running?" is answerable from the UI. */
function recordTick(conn: BetterSqlite3.Database, now: Date, result: DispatchResult): void {
  conn
    .prepare(
      `INSERT INTO scheduler_state (id, last_run_at, last_due, last_sent, last_failed)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_run_at = excluded.last_run_at,
         last_due = excluded.last_due,
         last_sent = excluded.last_sent,
         last_failed = excluded.last_failed`
    )
    .run(now.toISOString(), result.due, result.sent, result.failed);
}

/**
 * A claim older than this is assumed to belong to a crashed run and is released
 * so the schedule can fire again. Long enough that a slow Gmail call is never
 * treated as a crash.
 */
const STALE_CLAIM_MS = 10 * 60 * 1000;

function releaseStaleClaims(conn: BetterSqlite3.Database, now: Date): void {
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  const info = conn
    .prepare(
      `UPDATE scheduled_emails
       SET status = CASE schedule_type WHEN 'repeat' THEN 'active' ELSE 'scheduled' END
       WHERE status = 'processing' AND updated_at <= ?`
    )
    .run(cutoff);
  if (info.changes > 0) {
    console.log(`[SCHEDULER] Released ${info.changes} schedule(s) stuck in processing`);
  }
}

/**
 * Claims one occurrence for this run. The WHERE clause is the lock: only one
 * caller can move a row out of active/scheduled for a given next_send_at, so a
 * second overlapping cron invocation gets changes === 0 and walks away.
 */
function claimSchedule(
  conn: BetterSqlite3.Database,
  id: number,
  occurrenceKey: string,
  now: Date
): boolean {
  // Stamped with the same clock the staleness check uses, so a claim made in
  // this tick can never be read as abandoned by the next one.
  const info = conn
    .prepare(
      `UPDATE scheduled_emails SET status = 'processing', updated_at = ?
       WHERE id = ? AND next_send_at = ? AND status IN ('active','scheduled')`
    )
    .run(now.toISOString(), id, occurrenceKey);
  return info.changes === 1;
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

  releaseStaleClaims(conn, now);

  const dueRows = conn
    .prepare(
      `SELECT * FROM scheduled_emails
       WHERE status IN ('active','scheduled')
         AND next_send_at IS NOT NULL
         AND next_send_at <= ?
       ORDER BY next_send_at
       LIMIT 200`
    )
    .all(now.toISOString()) as ScheduledEmail[];

  console.log(`[SCHEDULER] Found ${dueRows.length} due schedule(s)`);

  for (const schedule of dueRows) {
    const occurrenceKey = schedule.next_send_at as string;
    const firedAt = new Date(occurrenceKey);

    // scheduled/active → processing. Losing the race is normal, not an error.
    if (!claimSchedule(conn, schedule.id, occurrenceKey, now)) {
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

      // processing → active / scheduled / completed / failed. No retry of this
      // occurrence: a recurring schedule moves on to its next one.
      advanceSchedule(schedule, firedAt, attempt.failed > 0 && attempt.sent === 0, { ...deps, conn });
      const finalStatus = (
        conn.prepare('SELECT status FROM scheduled_emails WHERE id = ?').get(schedule.id) as { status: string }
      ).status;
      console.log(
        `[SCHEDULER] Schedule ${schedule.id} marked as ${finalStatus} (sent=${attempt.sent} failed=${attempt.failed})`
      );
    } catch (err) {
      // Something outside the per-recipient send failed. Don't leave the row
      // locked in processing.
      const message = err instanceof Error ? err.message : 'Unknown scheduler error';
      console.error(`[SCHEDULER] Failed to process schedule: ${schedule.id}`);
      console.error(`[SCHEDULER] Error: ${message}`);
      result.failed++;
      result.errors.push(`Schedule ${schedule.id}: ${message}`);
      advanceSchedule(schedule, firedAt, true, { ...deps, conn });
    }
  }

  purgeOrphanUploads(conn, now);
  recordTick(conn, now, result);
  return result;
}
