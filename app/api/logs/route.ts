import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/session';

export const runtime = 'nodejs';

interface LogRowFromDb {
  id: number;
  recipient_email: string;
  sent_at: string | null;
  status: string;
  error_message: string | null;
  occurrence_key: string;
  schedule_id: number;
  subject: string;
  body: string;
  timezone: string;
}

/** Sent history: logs joined to their schedule, scoped to the signed-in user. */
export function GET(req: NextRequest) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const rows = db()
    .prepare(
      `SELECT l.id, l.recipient_email, l.sent_at, l.status, l.error_message, l.occurrence_key,
              s.id AS schedule_id, s.subject, s.body, s.timezone
       FROM email_logs l
       JOIN scheduled_emails s ON s.id = l.scheduled_email_id
       WHERE s.user_id = ? AND l.status IN ('sent','failed')
       ORDER BY l.sent_at DESC, l.id DESC
       LIMIT 300`
    )
    .all(user.id) as LogRowFromDb[];

  const recipientsStmt = db().prepare(
    `SELECT r.id, r.name, r.email FROM scheduled_email_recipients ser
     JOIN recipients r ON r.id = ser.recipient_id
     WHERE ser.scheduled_email_id = ? ORDER BY r.name`
  );

  const attachmentsStmt = db().prepare(
    `SELECT id, filename, mime_type AS mimeType, size_bytes AS sizeBytes
     FROM attachments WHERE scheduled_email_id = ? ORDER BY id`
  );

  const logsWithDetails = rows.map((log) => {
    const recipients = recipientsStmt.all(log.schedule_id) as { id: number; name: string; email: string }[];
    const attachments = attachmentsStmt.all(log.schedule_id) as { id: number; filename: string; mimeType: string; sizeBytes: number }[];
    return {
      ...log,
      recipients: recipients.length > 0 ? recipients : [{ id: 0, name: log.recipient_email, email: log.recipient_email }],
      attachments,
    };
  });

  return NextResponse.json({ logs: logsWithDetails });
}
