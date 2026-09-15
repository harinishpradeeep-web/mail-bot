import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { recipients } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { currentUser } from '@/lib/session';
import { validateRecipient } from '@/lib/validate';

export const runtime = 'nodejs';

type Params = { params: { id: string } };

async function owned(userId: number, id: number) {
  const rows = await db()
    .select()
    .from(recipients)
    .where(and(eq(recipients.id, id), eq(recipients.userId, userId)))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    user_id: r.userId,
    name: r.name,
    email: r.email,
    department: r.department,
    notes: r.notes,
    created_at: r.createdAt,
  };
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const id = Number(params.id);
  const existing = await owned(user.id, id);
  if (!existing) return NextResponse.json({ error: 'Recipient not found.' }, { status: 404 });

  const parsed = validateRecipient(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    await db()
      .update(recipients)
      .set({
        name: parsed.value.name,
        email: parsed.value.email,
        department: parsed.value.department,
        notes: parsed.value.notes,
      })
      .where(and(eq(recipients.id, id), eq(recipients.userId, user.id)));
  } catch {
    return NextResponse.json({ error: 'Another recipient already uses that email.' }, { status: 409 });
  }

  const updated = await owned(user.id, id);
  return NextResponse.json({ recipient: updated });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const id = Number(params.id);
  const deleted = await db()
    .delete(recipients)
    .where(and(eq(recipients.id, id), eq(recipients.userId, user.id)))
    .returning({ id: recipients.id });

  if (deleted.length === 0) return NextResponse.json({ error: 'Recipient not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
