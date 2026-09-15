import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/session';
import {
  MAX_FILES_PER_EMAIL,
  MAX_TOTAL_BYTES,
  formatBytes,
  validateUpload,
} from '@/lib/attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Upload endpoint for the composer. Files land unattached (scheduled_email_id
 * NULL) and are bound to a schedule when it is created or edited.
 *
 * Accepts multipart/form-data with one or more `files` fields.
 */
export async function POST(req: NextRequest) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'That upload could not be read. Try again.' }, { status: 400 });
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: 'No file was received.' }, { status: 400 });
  if (files.length > MAX_FILES_PER_EMAIL) {
    return NextResponse.json(
      { error: `You can attach up to ${MAX_FILES_PER_EMAIL} files to one email.` },
      { status: 400 }
    );
  }

  const insert = db().prepare(
    'INSERT INTO attachments (user_id, filename, mime_type, size_bytes, content) VALUES (?,?,?,?,?)'
  );

  const saved: { id: number; filename: string; mime_type: string; size_bytes: number }[] = [];

  for (const file of files) {
    // The browser's filename and type are both treated as untrusted here.
    const check = validateUpload(file.name, file.size);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

    const bytes = Buffer.from(await file.arrayBuffer());
    // Re-check against the bytes actually received, not the declared size.
    const recheck = validateUpload(file.name, bytes.byteLength);
    if (!recheck.ok) return NextResponse.json({ error: recheck.error }, { status: 400 });

    const id = Number(
      insert.run(user.id, recheck.filename, recheck.mimeType, bytes.byteLength, bytes).lastInsertRowid
    );
    saved.push({ id, filename: recheck.filename, mime_type: recheck.mimeType, size_bytes: bytes.byteLength });
  }

  const total = saved.reduce((sum, f) => sum + f.size_bytes, 0);
  if (total > MAX_TOTAL_BYTES) {
    // Roll back rather than leave oversized rows behind.
    const del = db().prepare('DELETE FROM attachments WHERE id = ? AND user_id = ?');
    for (const f of saved) del.run(f.id, user.id);
    return NextResponse.json(
      { error: `Those files total ${formatBytes(total)}. The limit is ${formatBytes(MAX_TOTAL_BYTES)} per email.` },
      { status: 400 }
    );
  }

  return NextResponse.json({ attachments: saved }, { status: 201 });
}
