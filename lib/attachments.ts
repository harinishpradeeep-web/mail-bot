import type BetterSqlite3 from 'better-sqlite3';
import { db } from './db';

/**
 * Attachment storage. Server-only: this module touches the database, so it must
 * never be imported by a client component — see lib/attachment-limits.ts for
 * the parts the composer needs.
 *
 * Files are stored as BLOBs in the same SQLite database as everything else, so
 * a scheduled email keeps its attachments until it fires and nothing is written
 * to a public directory.
 */

export * from './attachment-limits';
import type { AttachmentMeta, StoredAttachment } from './attachment-limits';

/** Total size of a set of the caller's own attachments, for the per-email cap. */
export function totalBytesOf(userId: number, ids: number[], conn: BetterSqlite3.Database = db()): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const row = conn
    .prepare(`SELECT COALESCE(SUM(size_bytes), 0) AS total FROM attachments WHERE user_id = ? AND id IN (${placeholders})`)
    .get(userId, ...ids) as { total: number };
  return row.total;
}

/** Metadata only — the BLOB is never sent to the browser. */
export function attachmentsForSchedule(
  scheduleId: number,
  conn: BetterSqlite3.Database = db()
): AttachmentMeta[] {
  return conn
    .prepare(
      'SELECT id, filename, mime_type, size_bytes FROM attachments WHERE scheduled_email_id = ? ORDER BY id'
    )
    .all(scheduleId) as AttachmentMeta[];
}

/** Full rows, including content — used only at send time on the server. */
export function attachmentContentForSchedule(
  scheduleId: number,
  conn: BetterSqlite3.Database = db()
): StoredAttachment[] {
  return conn
    .prepare(
      'SELECT id, filename, mime_type, size_bytes, content FROM attachments WHERE scheduled_email_id = ? ORDER BY id'
    )
    .all(scheduleId) as StoredAttachment[];
}

/**
 * Binds uploaded files to a schedule. Only rows the caller owns and that are
 * not already attached elsewhere can be claimed.
 */
export function linkAttachments(
  userId: number,
  scheduleId: number,
  ids: number[],
  conn: BetterSqlite3.Database = db()
): void {
  const claim = conn.prepare(
    `UPDATE attachments SET scheduled_email_id = ?
     WHERE id = ? AND user_id = ? AND (scheduled_email_id IS NULL OR scheduled_email_id = ?)`
  );
  for (const id of ids) claim.run(scheduleId, id, userId, scheduleId);
}

/** Used when editing: drop files the user removed from this schedule. */
export function unlinkRemovedAttachments(
  scheduleId: number,
  keepIds: number[],
  conn: BetterSqlite3.Database = db()
): void {
  if (keepIds.length === 0) {
    conn.prepare('DELETE FROM attachments WHERE scheduled_email_id = ?').run(scheduleId);
    return;
  }
  const placeholders = keepIds.map(() => '?').join(',');
  conn
    .prepare(`DELETE FROM attachments WHERE scheduled_email_id = ? AND id NOT IN (${placeholders})`)
    .run(scheduleId, ...keepIds);
}

/**
 * Uploads that were never attached to anything (composer abandoned) would
 * otherwise sit in the database forever.
 */
export function purgeOrphanUploads(conn: BetterSqlite3.Database = db(), now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const info = conn
    .prepare('DELETE FROM attachments WHERE scheduled_email_id IS NULL AND created_at <= ?')
    .run(cutoff);
  return info.changes;
}
