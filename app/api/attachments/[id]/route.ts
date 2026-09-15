import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * Serves an attachment file for viewing or downloading.
 * Scoped by user_id so users can only access their own attachments.
 */
export function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const attId = Number(params.id);
  if (!attId || Number.isNaN(attId)) {
    return NextResponse.json({ error: 'Invalid attachment ID.' }, { status: 400 });
  }

  const row = db()
    .prepare('SELECT id, filename, mime_type, size_bytes, content FROM attachments WHERE id = ? AND user_id = ?')
    .get(attId, user.id) as
    | {
        id: number;
        filename: string;
        mime_type: string;
        size_bytes: number;
        content: Buffer;
      }
    | undefined;

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
export function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const info = db()
    .prepare('DELETE FROM attachments WHERE id = ? AND user_id = ?')
    .run(Number(params.id), user.id);

  if (info.changes === 0) return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
