import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getPool } from '@/lib/db';
import { signupSchema, parseOrError } from '@/lib/schemas';
import { signupLimiter, checkRateLimit, getClientIp } from '@/lib/rate-limit';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export async function POST(req: NextRequest) {
  const blocked = await checkRateLimit(signupLimiter, getClientIp(req.headers));
  if (blocked) return blocked;

  const parsed = parseOrError(signupSchema, await req.json());
  if ('error' in parsed) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { email, password, name, orgName } = parsed.data;

  const db = getPool();
  const normalizedEmail = email.toLowerCase().trim();

  // Check if email already exists — return generic response to prevent enumeration
  const { rows: existing } = await db.query(
    'SELECT id FROM users WHERE email = $1',
    [normalizedEmail],
  );
  if (existing.length > 0) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Create organisation
  const orgId = `org_${crypto.randomUUID()}`;
  const orgSlug = slugify(orgName);

  // Check slug uniqueness
  const { rows: slugCheck } = await db.query(
    'SELECT id FROM organisations WHERE slug = $1',
    [orgSlug],
  );
  const finalSlug = slugCheck.length > 0 ? `${orgSlug}-${crypto.randomUUID().slice(0, 8)}` : orgSlug;

  await db.query(
    `INSERT INTO organisations (id, name, slug) VALUES ($1, $2, $3)`,
    [orgId, orgName.trim(), finalSlug],
  );

  // Create user
  const userId = `usr_${crypto.randomUUID()}`;
  const passwordHash = await bcrypt.hash(password, 12);

  await db.query(
    `INSERT INTO users (id, email, password_hash, name, org_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, normalizedEmail, passwordHash, (name || '').trim() || 'User', orgId],
  );

  return NextResponse.json({ ok: true });
}
