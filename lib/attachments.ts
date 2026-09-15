import { db, type AppDb } from './db';
import { attachments } from './db/schema';
import { eq, and, inArray, notInArray, isNull, or, lte, sql } from 'drizzle-orm';

export * from './attachment-limits';
import type { AttachmentMeta, StoredAttachment } from './attachment-limits';

/** Total size of a set of the caller's own attachments, for the per-email cap. */
export async function totalBytesOf(
  userId: number,
  ids: number[],
  conn: AppDb = db()
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await conn
    .select({
      total: sql<number>`COALESCE(SUM(${attachments.sizeBytes}), 0)`,
    })
    .from(attachments)
    .where(and(eq(attachments.userId, userId), inArray(attachments.id, ids)));
  return Number(result[0]?.total ?? 0);
}

/** Metadata only — the BLOB is never sent to the browser. */
export async function attachmentsForSchedule(
  scheduleId: number,
  conn: AppDb = db()
): Promise<AttachmentMeta[]> {
  const rows = await conn
    .select({
      id: attachments.id,
      filename: attachments.filename,
      mime_type: attachments.mimeType,
      size_bytes: attachments.sizeBytes,
    })
    .from(attachments)
    .where(eq(attachments.scheduledEmailId, scheduleId))
    .orderBy(attachments.id);
  return rows;
}

/** Full rows, including content — used only at send time on the server. */
export async function attachmentContentForSchedule(
  scheduleId: number,
  conn: AppDb = db()
): Promise<StoredAttachment[]> {
  const rows = await conn
    .select({
      id: attachments.id,
      filename: attachments.filename,
      mime_type: attachments.mimeType,
      size_bytes: attachments.sizeBytes,
      content: attachments.content,
    })
    .from(attachments)
    .where(eq(attachments.scheduledEmailId, scheduleId))
    .orderBy(attachments.id);
  return rows;
}

/**
 * Binds uploaded files to a schedule. Only rows the caller owns and that are
 * not already attached elsewhere can be claimed.
 */
export async function linkAttachments(
  userId: number,
  scheduleId: number,
  ids: number[],
  conn: AppDb = db()
): Promise<void> {
  if (ids.length === 0) return;
  for (const id of ids) {
    await conn
      .update(attachments)
      .set({ scheduledEmailId: scheduleId })
      .where(
        and(
          eq(attachments.id, id),
          eq(attachments.userId, userId),
          or(isNull(attachments.scheduledEmailId), eq(attachments.scheduledEmailId, scheduleId))
        )
      );
  }
}

/** Used when editing: drop files the user removed from this schedule. */
export async function unlinkRemovedAttachments(
  scheduleId: number,
  keepIds: number[],
  conn: AppDb = db()
): Promise<void> {
  if (keepIds.length === 0) {
    await conn
      .delete(attachments)
      .where(eq(attachments.scheduledEmailId, scheduleId));
    return;
  }
  await conn
    .delete(attachments)
    .where(
      and(
        eq(attachments.scheduledEmailId, scheduleId),
        notInArray(attachments.id, keepIds)
      )
    );
}

/**
 * Uploads that were never attached to anything (composer abandoned) would
 * otherwise sit in the database forever.
 */
export async function purgeOrphanUploads(
  conn: AppDb = db(),
  now: Date = new Date()
): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const deleted = await conn
    .delete(attachments)
    .where(and(isNull(attachments.scheduledEmailId), lte(attachments.createdAt, cutoff)))
    .returning({ id: attachments.id });
  return deleted.length;
}
