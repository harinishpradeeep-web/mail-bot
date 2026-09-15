import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { validateRecipient } from '@/lib/validate';

export const runtime = 'nodejs';

export function GET(req: NextRequest) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const rows = db()
    .prepare('SELECT * FROM recipients WHERE user_id = ? ORDER BY name COLLATE NOCASE')
    .all(user.id);
  return NextResponse.json({ recipients: rows });
}

export async function POST(req: NextRequest) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const parsed = validateRecipient(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const id = db()
      .prepare('INSERT INTO recipients (user_id, name, email, department, notes) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, parsed.value.name, parsed.value.email, parsed.value.department, parsed.value.notes)
      .lastInsertRowid;
    const row = db().prepare('SELECT * FROM recipients WHERE id = ?').get(Number(id));
    return NextResponse.json({ recipient: row }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'That email is already in your recipient list.' }, { status: 409 });
  }
}
