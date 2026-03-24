import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getPool } from '@/lib/db';
import { getAuthSession } from '@/lib/auth-helpers';

export async function GET() {
  const session = await getAuthSession();
  const db = getPool();
  const { rows } = await db.query(
    `SELECT i.id, i.email, i.token, i.expires_at AS "expiresAt",
            i.accepted_at AS "acceptedAt", i.created_at AS "createdAt",
            u.name AS "invitedByName"
     FROM invitations i
     JOIN users u ON u.id = i.invited_by
     WHERE i.org_id = $1
     ORDER BY i.created_at DESC`,
    [session.orgId],
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  const { email } = await req.json();
  if (!email?.trim()) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const normalizedEmail = email.toLowerCase().trim();
  const db = getPool();

  // Check if user already exists in this org
  const { rows: existingUsers } = await db.query(
    'SELECT id FROM users WHERE email = $1 AND org_id = $2',
    [normalizedEmail, session.orgId],
  );
  if (existingUsers.length > 0) {
    return NextResponse.json({ error: 'User is already a member of this organisation' }, { status: 409 });
  }

  // Check for pending invitation
  const { rows: existingInvites } = await db.query(
    `SELECT id FROM invitations
     WHERE org_id = $1 AND email = $2 AND accepted_at IS NULL AND expires_at > NOW()`,
    [session.orgId, normalizedEmail],
  );
  if (existingInvites.length > 0) {
    return NextResponse.json({ error: 'An invitation has already been sent to this email' }, { status: 409 });
  }

  const id = `inv_${Date.now()}`;
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  await db.query(
    `INSERT INTO invitations (id, org_id, email, invited_by, token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, session.orgId, normalizedEmail, session.userId, token, expiresAt],
  );

  return NextResponse.json({ ok: true, token, expiresAt });
}

export async function DELETE(req: NextRequest) {
  const session = await getAuthSession();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getPool();
  await db.query('DELETE FROM invitations WHERE id = $1 AND org_id = $2', [id, session.orgId]);
  return NextResponse.json({ ok: true });
}
