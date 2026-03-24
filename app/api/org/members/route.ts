import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getAuthSession } from '@/lib/auth-helpers';

export async function GET() {
  const session = await getAuthSession();
  const db = getPool();
  const { rows } = await db.query(
    `SELECT id, email, name, created_at AS "createdAt"
     FROM users WHERE org_id = $1 ORDER BY created_at`,
    [session.orgId],
  );
  return NextResponse.json(rows);
}

export async function DELETE(req: NextRequest) {
  const session = await getAuthSession();
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  // Cannot remove yourself
  if (userId === session.userId) {
    return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 });
  }

  const db = getPool();

  // Verify user belongs to this org
  const { rows } = await db.query(
    'SELECT id FROM users WHERE id = $1 AND org_id = $2',
    [userId, session.orgId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'user not found' }, { status: 404 });

  await db.query('DELETE FROM users WHERE id = $1 AND org_id = $2', [userId, session.orgId]);
  return NextResponse.json({ ok: true });
}
