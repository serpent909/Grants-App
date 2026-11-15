import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getPool, withTransaction } from '@/lib/db';
import { publicRoute, parseBody, enforceRateLimit, ApiError } from '@/lib/api';
import { resetPasswordSchema } from '@/lib/schemas';
import { authLimiter, getClientIp } from '@/lib/rate-limit';
import { hashAuthToken } from '@/lib/auth-tokens';
import { forgetUser } from '@/lib/auth';

const INVALID_LINK = 'This reset link is invalid, has expired, or has already been used';

// GET: check a reset link before showing the form. Reveals nothing about the account.
export const GET = publicRoute(async req => {
  await enforceRateLimit(authLimiter, getClientIp(req.headers));

  const token = req.nextUrl.searchParams.get('token');
  if (!token || token.length > 200) throw new ApiError(400, 'token required');

  const { rows } = await getPool().query(
    `SELECT 1 FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [hashAuthToken(token)],
  );
  if (rows.length === 0) throw new ApiError(410, INVALID_LINK);

  return NextResponse.json({ ok: true });
});

// POST: set a new password using a reset token.
export const POST = publicRoute(async req => {
  await enforceRateLimit(authLimiter, getClientIp(req.headers));

  const { token, password } = await parseBody(req, resetPasswordSchema);
  const passwordHash = await bcrypt.hash(password, 12);
  // App clock, not NOW(): compared with sign-in times stamped by the app (lib/auth.ts).
  const changedAt = new Date().toISOString();

  const userId = await withTransaction(async client => {
    // Claim the token atomically: of two concurrent requests, only one gets a row.
    const { rows } = await client.query<{ user_id: string }>(
      `UPDATE password_reset_tokens SET used_at = NOW()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [hashAuthToken(token)],
    );
    const claimed = rows[0];
    if (!claimed) throw new ApiError(410, INVALID_LINK);

    // Receiving the link proves control of the mailbox, so it also verifies the address.
    await client.query(
      `UPDATE users
       SET password_hash = $1,
           password_changed_at = $2,
           email_verified = COALESCE(email_verified, NOW()),
           updated_at = NOW()
       WHERE id = $3`,
      [passwordHash, changedAt, claimed.user_id],
    );

    // Any other outstanding reset links for this account are now void.
    await client.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
      [claimed.user_id],
    );
    return claimed.user_id;
  });

  // Existing sessions are rejected at their next revalidation (lib/auth.ts).
  forgetUser(userId);
  return NextResponse.json({ ok: true });
});
