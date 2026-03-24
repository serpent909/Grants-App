import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getPool } from '@/lib/db';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export async function POST(req: NextRequest) {
  const { email, password, name, orgName } = await req.json();

  if (!email || !password || !orgName) {
    return NextResponse.json(
      { error: 'Email, password, and organisation name are required' },
      { status: 400 },
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 },
    );
  }

  const db = getPool();
  const normalizedEmail = email.toLowerCase().trim();

  // Check if email already exists
  const { rows: existing } = await db.query(
    'SELECT id FROM users WHERE email = $1',
    [normalizedEmail],
  );
  if (existing.length > 0) {
    return NextResponse.json(
      { error: 'An account with this email already exists' },
      { status: 409 },
    );
  }

  // Create organisation
  const orgId = `org_${Date.now()}`;
  const orgSlug = slugify(orgName);

  // Check slug uniqueness
  const { rows: slugCheck } = await db.query(
    'SELECT id FROM organisations WHERE slug = $1',
    [orgSlug],
  );
  const finalSlug = slugCheck.length > 0 ? `${orgSlug}-${Date.now()}` : orgSlug;

  await db.query(
    `INSERT INTO organisations (id, name, slug) VALUES ($1, $2, $3)`,
    [orgId, orgName.trim(), finalSlug],
  );

  // Create user
  const userId = `usr_${Date.now()}`;
  const passwordHash = await bcrypt.hash(password, 12);

  await db.query(
    `INSERT INTO users (id, email, password_hash, name, org_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, normalizedEmail, passwordHash, (name || '').trim() || 'User', orgId],
  );

  return NextResponse.json({
    ok: true,
    userId,
    orgId,
    email: normalizedEmail,
  });
}
