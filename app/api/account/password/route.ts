import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getPool } from '@/lib/db';
import { authedRoute, parseBody, enforceRateLimit, ApiError } from '@/lib/api';
import { changePasswordSchema } from '@/lib/schemas';
import { authLimiter } from '@/lib/rate-limit';

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
  await db.query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3',
    [passwordHash, userId, orgId],
  );

  return NextResponse.json({ ok: true });
});
