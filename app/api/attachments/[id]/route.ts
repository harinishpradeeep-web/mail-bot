import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { attachments } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { currentUser } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * Serves an attachment file for viewing or downloading.
 * Scoped by user_id so users can only access their own attachments.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const attId = Number(params.id);
  if (!attId || Number.isNaN(attId)) {
    return NextResponse.json({ error: 'Invalid attachment ID.' }, { status: 400 });
  }

  const rows = await db()
    .select({
      id: attachments.id,
      filename: attachments.filename,
      mime_type: attachments.mimeType,
      size_bytes: attachments.sizeBytes,
      content: attachments.content,
    })
    .from(attachments)
    .where(and(eq(attachments.id, attId), eq(attachments.userId, user.id)))
    .limit(1);

  const row = rows[0];
  if (!row) return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });

  const url = new URL(req.url);
  const forceDownload = url.searchParams.get('download') === '1';
  const disposition = forceDownload ? 'attachment' : 'inline';

  return new NextResponse(new Uint8Array(row.content), {
    status: 200,
    headers: {
      'Content-Type': row.mime_type || 'application/octet-stream',
      'Content-Disposition': `${disposition}; filename="${encodeURIComponent(row.filename)}"`,
      'Content-Length': String(row.size_bytes),
    },
  });
}

/**
 * Removes one attachment. Scoped by user_id, so nobody can delete another
 * account's file.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const deleted = await db()
    .delete(attachments)
    .where(and(eq(attachments.id, Number(params.id)), eq(attachments.userId, user.id)))
    .returning({ id: attachments.id });

  if (deleted.length === 0) return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
