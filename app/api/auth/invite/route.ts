import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getPool } from '@/lib/db';
import { acceptInviteSchema, parseOrError } from '@/lib/schemas';
import { authLimiter, checkRateLimit, getClientIp } from '@/lib/rate-limit';

// GET: validate token and return org info
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const db = getPool();
  const { rows } = await db.query(
    `SELECT i.id, i.email, i.expires_at, i.accepted_at, o.name AS org_name
     FROM invitations i
     JOIN organisations o ON o.id = i.org_id
     WHERE i.token = $1`,
    [token],
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Invalid invitation link' }, { status: 404 });
  }

  const invite = rows[0];
  if (invite.accepted_at) {
    return NextResponse.json({ error: 'This invitation has already been used' }, { status: 410 });
  }
  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This invitation has expired' }, { status: 410 });
  }

  return NextResponse.json({
    email: invite.email,
    orgName: invite.org_name,
  });
}

// POST: accept invitation — create user and join org
export async function POST(req: NextRequest) {
  const blocked = await checkRateLimit(authLimiter, getClientIp(req.headers));
  if (blocked) return blocked;

  const parsed = parseOrError(acceptInviteSchema, await req.json());
  if ('error' in parsed) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { token, name, password } = parsed.data;

  const db = getPool();
  const { rows } = await db.query(
    `SELECT i.id, i.org_id, i.email, i.expires_at, i.accepted_at
     FROM invitations i WHERE i.token = $1`,
    [token],
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Invalid invitation link' }, { status: 404 });
  }

  const invite = rows[0];
  if (invite.accepted_at) {
    return NextResponse.json({ error: 'This invitation has already been used' }, { status: 410 });
  }
  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This invitation has expired' }, { status: 410 });
  }

  // Check if email is already registered
  const { rows: existingUsers } = await db.query(
    'SELECT id FROM users WHERE email = $1',
    [invite.email],
  );
  if (existingUsers.length > 0) {
    return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
  }

  // Create user
  const userId = `usr_${crypto.randomUUID()}`;
  const passwordHash = await bcrypt.hash(password, 12);

  await db.query(
    `INSERT INTO users (id, email, password_hash, name, org_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, invite.email, passwordHash, (name || '').trim() || 'User', invite.org_id],
  );

  // Mark invitation as accepted
  await db.query(
    'UPDATE invitations SET accepted_at = NOW() WHERE id = $1',
    [invite.id],
  );

  return NextResponse.json({
    ok: true,
    email: invite.email,
    userId,
  });
}
