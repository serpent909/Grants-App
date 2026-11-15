import { NextResponse, after } from 'next/server';
import bcrypt from 'bcryptjs';
import { getPool, withTransaction, isUniqueViolation } from '@/lib/db';
import { publicRoute, parseBody, throwIfLimited } from '@/lib/api';
import { signupSchema } from '@/lib/schemas';
import { signupLimiter, getClientIp, getRateLimitOutcome, canSendEmail } from '@/lib/rate-limit';
import { getAppUrl } from '@/lib/app-url';
import { sendVerificationEmail } from '@/lib/account-emails';

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
  // Sign-up itself still works without a rate limiter, but the verification
  // email is only sent when one is enforcing a limit (see canSendEmail).
  const limit = await getRateLimitOutcome(signupLimiter, getClientIp(req.headers));
  throwIfLimited(limit);

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

  // Send the verification link once the response has gone, so the reply (and
  // its timing) is the same as for an email that was already registered.
  // Unverified accounts are nudged, not blocked — a failed send is not fatal:
  // the in-app banner offers to send it again.
  if (canSendEmail(limit)) {
    const requestOrigin = req.nextUrl.origin;
    after(async () => {
      try {
        // Resolved inside the try: a missing APP_URL must not turn a successful
        // sign-up into an error response.
        await sendVerificationEmail({ id: userId, email: normalizedEmail }, getAppUrl(requestOrigin));
      } catch (err) {
        console.error('[auth] Verification email failed:', err);
      }
    });
  }

  return NextResponse.json({ ok: true });
});
