import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { recipients } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { currentUser } from '@/lib/session';
import { validateRecipient } from '@/lib/validate';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const rawRows = await db()
    .select()
    .from(recipients)
    .where(eq(recipients.userId, user.id))
    .orderBy(recipients.name);

  const formattedRows = rawRows.map((r) => ({
    id: r.id,
    user_id: r.userId,
    name: r.name,
    email: r.email,
    department: r.department,
    notes: r.notes,
    created_at: r.createdAt,
  }));

  return NextResponse.json({ recipients: formattedRows });
}

export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const parsed = validateRecipient(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const inserted = await db()
      .insert(recipients)
      .values({
        userId: user.id,
        name: parsed.value.name,
        email: parsed.value.email,
        department: parsed.value.department,
        notes: parsed.value.notes,
      })
      .returning();

    const r = inserted[0];
    const row = {
      id: r.id,
      user_id: r.userId,
      name: r.name,
      email: r.email,
      department: r.department,
      notes: r.notes,
      created_at: r.createdAt,
    };

    return NextResponse.json({ recipient: row }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'That email is already in your recipient list.' }, { status: 409 });
  }
}
