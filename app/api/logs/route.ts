import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { emailLogs, scheduledEmails, scheduledEmailRecipients, recipients, attachments } from '@/lib/db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { currentUser } from '@/lib/session';

export const runtime = 'nodejs';

/** Sent history: logs joined to their schedule, scoped to the signed-in user. */
export async function GET(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const database = db();

  const rows = await database
    .select({
      id: emailLogs.id,
      recipient_email: emailLogs.recipientEmail,
      sent_at: emailLogs.sentAt,
      status: emailLogs.status,
      error_message: emailLogs.errorMessage,
      occurrence_key: emailLogs.occurrenceKey,
      schedule_id: scheduledEmails.id,
      subject: scheduledEmails.subject,
      body: scheduledEmails.body,
      timezone: scheduledEmails.timezone,
    })
    .from(emailLogs)
    .innerJoin(scheduledEmails, eq(scheduledEmails.id, emailLogs.scheduledEmailId))
    .where(and(eq(scheduledEmails.userId, user.id), inArray(emailLogs.status, ['sent', 'failed'])))
    .orderBy(desc(emailLogs.sentAt), desc(emailLogs.id))
    .limit(300);

  const logsWithDetails = [];

  for (const log of rows) {
    const recs = await database
      .select({
        id: recipients.id,
        name: recipients.name,
        email: recipients.email,
      })
      .from(scheduledEmailRecipients)
      .innerJoin(recipients, eq(recipients.id, scheduledEmailRecipients.recipientId))
      .where(eq(scheduledEmailRecipients.scheduledEmailId, log.schedule_id))
      .orderBy(recipients.name);

    const atts = await database
      .select({
        id: attachments.id,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        sizeBytes: attachments.sizeBytes,
      })
      .from(attachments)
      .where(eq(attachments.scheduledEmailId, log.schedule_id))
      .orderBy(attachments.id);

    logsWithDetails.push({
      ...log,
      recipients: recs.length > 0 ? recs : [{ id: 0, name: log.recipient_email, email: log.recipient_email }],
      attachments: atts,
    });
  }

  return NextResponse.json({ logs: logsWithDetails });
}
