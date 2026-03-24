import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getAuthSession } from '@/lib/auth-helpers';

export async function GET() {
  const session = await getAuthSession();
  const db = getPool();
  const { rows } = await db.query(
    'SELECT id, name, slug, created_at AS "createdAt" FROM organisations WHERE id = $1',
    [session.orgId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function PUT(req: NextRequest) {
  const session = await getAuthSession();
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const db = getPool();
  await db.query(
    'UPDATE organisations SET name = $1, updated_at = NOW() WHERE id = $2',
    [name.trim(), session.orgId],
  );
  return NextResponse.json({ ok: true });
}
