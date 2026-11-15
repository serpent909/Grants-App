import { NextResponse } from 'next/server';
import { getPool, withTransaction } from '@/lib/db';
import { publicRoute, parseBody, enforceRateLimit, ApiError } from '@/lib/api';
import { verifyEmailSchema } from '@/lib/schemas';
import { authLimiter, getClientIp } from '@/lib/rate-limit';
import { hashAuthToken } from '@/lib/auth-tokens';

/**
 * Confirm an email address using the token from the verification email.
 * Public: the link is often opened on a device that is not signed in.
 * Idempotent: opening an already-used link reports success again.
 */
export const POST = publicRoute(async req => {
  await enforceRateLimit(authLimiter, getClientIp(req.headers));

  const { token } = await parseBody(req, verifyEmailSchema);
  const tokenHash = hashAuthToken(token);

  const verified = await withTransaction(async client => {
    const { rows } = await client.query<{ user_id: string }>(
      `UPDATE email_verification_tokens SET used_at = NOW()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [tokenHash],
    );
    if (!rows[0]) return false;
    await client.query(
      `UPDATE users SET email_verified = COALESCE(email_verified, NOW()), updated_at = NOW()
       WHERE id = $1`,
      [rows[0].user_id],
    );
    return true;
  });

  if (!verified) {
    const { rows } = await getPool().query(
      'SELECT 1 FROM email_verification_tokens WHERE token_hash = $1 AND used_at IS NOT NULL',
      [tokenHash],
    );
    if (rows.length === 0) throw new ApiError(410, 'This verification link is invalid or has expired');
  }

  return NextResponse.json({ ok: true });
});
