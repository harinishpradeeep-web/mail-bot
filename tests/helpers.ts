import type BetterSqlite3 from 'better-sqlite3';
import { createTestDb } from '@/lib/db';
import type { ScheduledEmail, Weekday } from '@/lib/types';

export interface SeedOptions {
  scheduleType?: 'now' | 'once' | 'repeat';
  timezone?: string;
  startDate?: string;
  startTime?: string;
  repeatFrequency?: 'daily' | 'weekly' | 'monthly' | 'custom' | null;
  repeatDays?: Weekday[] | null;
  endDate?: string | null;
  nextSendAt?: string;
  status?: string;
  recipients?: { name: string; email: string }[];
}

export function seed(opts: SeedOptions = {}) {
  const conn: BetterSqlite3.Database = createTestDb();

  const userId = Number(
    conn
      .prepare('INSERT INTO users (google_id, email, name, gmail_connected) VALUES (?,?,?,1)')
      .run('google-1', 'student@gmail.com', 'Student').lastInsertRowid
  );

  const recipients = opts.recipients ?? [{ name: 'Dr. Sharma', email: 'professor@gmail.com' }];
  const recipientIds = recipients.map((r) =>
    Number(
      conn
        .prepare('INSERT INTO recipients (user_id, name, email) VALUES (?,?,?)')
        .run(userId, r.name, r.email).lastInsertRowid
    )
  );

  const scheduleType = opts.scheduleType ?? 'repeat';
  const nextSendAt = opts.nextSendAt ?? '2026-09-15T02:30:00.000Z';

  const scheduleId = Number(
    conn
      .prepare(
        `INSERT INTO scheduled_emails
          (user_id, subject, body, schedule_type, timezone, repeat_frequency, repeat_days,
           start_date, start_time, end_date, next_send_at, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        userId,
        'Daily project update',
        'Good morning sir, here is my project update.',
        scheduleType,
        opts.timezone ?? 'Asia/Kolkata',
        scheduleType === 'repeat' ? opts.repeatFrequency ?? 'daily' : null,
        opts.repeatDays ? JSON.stringify(opts.repeatDays) : null,
        opts.startDate ?? '2026-09-15',
        opts.startTime ?? '08:00',
        opts.endDate ?? null,
        nextSendAt,
        opts.status ?? (scheduleType === 'repeat' ? 'active' : 'scheduled')
      ).lastInsertRowid
  );

  const link = conn.prepare('INSERT INTO scheduled_email_recipients (scheduled_email_id, recipient_id) VALUES (?,?)');
  for (const id of recipientIds) link.run(scheduleId, id);

  return {
    conn,
    userId,
    scheduleId,
    recipientIds,
    schedule: () => conn.prepare('SELECT * FROM scheduled_emails WHERE id = ?').get(scheduleId) as ScheduledEmail,
    logs: () => conn.prepare('SELECT * FROM email_logs WHERE scheduled_email_id = ?').all(scheduleId) as Record<string, unknown>[],
  };
}

/** Records every send instead of hitting the network. */
export function recordingMailer() {
  const sent: { to: string; subject: string; attachments?: { filename: string }[] }[] = [];
  return {
    sent,
    mailer: {
      async send(args: { to: string; subject: string; attachments?: { filename: string }[] }) {
        sent.push({ to: args.to, subject: args.subject, attachments: args.attachments ?? [] });
        return { id: `mock-${sent.length}` };
      },
    },
  };
}
