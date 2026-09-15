import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { validateRecipient } from '@/lib/validate';

export const runtime = 'nodejs';

type Params = { params: { id: string } };

/** Every query carries `AND user_id = ?` — that is the authorisation check. */
function owned(userId: number, id: number) {
  return db().prepare('SELECT * FROM recipients WHERE id = ? AND user_id = ?').get(id, userId);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const id = Number(params.id);
  if (!owned(user.id, id)) return NextResponse.json({ error: 'Recipient not found.' }, { status: 404 });

  const parsed = validateRecipient(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    db()
      .prepare('UPDATE recipients SET name = ?, email = ?, department = ?, notes = ? WHERE id = ? AND user_id = ?')
      .run(parsed.value.name, parsed.value.email, parsed.value.department, parsed.value.notes, id, user.id);
  } catch {
    return NextResponse.json({ error: 'Another recipient already uses that email.' }, { status: 409 });
  }
  return NextResponse.json({ recipient: owned(user.id, id) });
}

export function DELETE(req: NextRequest, { params }: Params) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const id = Number(params.id);
  const info = db().prepare('DELETE FROM recipients WHERE id = ? AND user_id = ?').run(id, user.id);
  if (info.changes === 0) return NextResponse.json({ error: 'Recipient not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
