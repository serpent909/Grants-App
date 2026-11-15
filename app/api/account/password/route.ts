import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getPool, withTransaction } from '@/lib/db';
import { authedRoute, parseBody, enforceRateLimit, ApiError } from '@/lib/api';
import { changePasswordSchema } from '@/lib/schemas';
import { authLimiter } from '@/lib/rate-limit';
import { forgetUser } from '@/lib/auth';

/** Change the signed-in user's password. Requires the current password. */
export const PUT = authedRoute(async (req, { userId, orgId }) => {
  // Throttle per user so a hijacked session cannot brute-force the current password.
  await enforceRateLimit(authLimiter, `pw:${userId}`);

  const { currentPassword, newPassword } = await parseBody(req, changePasswordSchema);
  const db = getPool();

  const { rows } = await db.query<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = $1 AND org_id = $2',
    [userId, orgId],
  );
  if (rows.length === 0) throw new ApiError(401, 'Unauthorized');

  const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!valid) throw new ApiError(400, 'Current password is incorrect');

  if (currentPassword === newPassword) {
    throw new ApiError(400, 'New password must be different from the current one');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  // Stamping password_changed_at signs out every session that signed in before
  // now (lib/auth.ts) — including this one, so the client signs in again with
  // the new password straight away. App clock, not NOW(): it is compared with
  // sign-in times stamped by the app.
  await withTransaction(async client => {
    await client.query(
      `UPDATE users SET password_hash = $1, password_changed_at = $2, updated_at = NOW()
       WHERE id = $3 AND org_id = $4`,
      [passwordHash, new Date().toISOString(), userId, orgId],
    );
    // A pending "forgot password" link must not outlive a deliberate change.
    await client.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
      [userId],
    );
  });
  forgetUser(userId);

  return NextResponse.json({ ok: true });
});
