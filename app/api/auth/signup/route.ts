import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getPool, withTransaction, isUniqueViolation } from '@/lib/db';
import { publicRoute, parseBody, enforceRateLimit } from '@/lib/api';
import { signupSchema } from '@/lib/schemas';
import { signupLimiter, getClientIp } from '@/lib/rate-limit';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export const POST = publicRoute(async req => {
  await enforceRateLimit(signupLimiter, getClientIp(req.headers));

  const { email, password, name, orgName } = await parseBody(req, signupSchema);
  const normalizedEmail = email.toLowerCase().trim();

  // Hash before touching the DB so the response time does not reveal whether
  // the email is already registered.
  const passwordHash = await bcrypt.hash(password, 12);

  // Email already registered → return the same generic response (no enumeration).
  const { rows: existing } = await getPool().query(
    'SELECT id FROM users WHERE email = $1',
    [normalizedEmail],
  );
  if (existing.length > 0) return NextResponse.json({ ok: true });

  const orgId = `org_${crypto.randomUUID()}`;
  const userId = `usr_${crypto.randomUUID()}`;
  // Always suffix the slug: no uniqueness race, and slugs don't reveal which
  // organisation names are already taken.
  const slug = `${slugify(orgName) || 'org'}-${crypto.randomUUID().slice(0, 8)}`;

  try {
    // Organisation + first user are created together or not at all.
    await withTransaction(async client => {
      await client.query(
        `INSERT INTO organisations (id, name, slug) VALUES ($1, $2, $3)`,
        [orgId, orgName, slug],
      );
      await client.query(
        `INSERT INTO users (id, email, password_hash, name, org_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, normalizedEmail, passwordHash, name.trim() || 'User', orgId],
      );
    });
  } catch (err) {
    // Lost a race with a concurrent signup for the same email — same generic reply.
    if (isUniqueViolation(err)) return NextResponse.json({ ok: true });
    throw err;
  }

  return NextResponse.json({ ok: true });
});
