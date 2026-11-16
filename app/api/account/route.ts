import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authedRoute, parseBody, ApiError } from '@/lib/api';
import { updateAccountSchema } from '@/lib/schemas';
import { forgetUser } from '@/lib/auth';

/** Update the signed-in user's own profile (display name). */
export const PUT = authedRoute(async (req, { userId, orgId }) => {
  const { name } = await parseBody(req, updateAccountSchema);
  const { rowCount } = await getPool().query(
    'UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3',
    [name, userId, orgId],
  );
  if (!rowCount) throw new ApiError(401, 'Unauthorized');
  // The session picks the new name up on its next refresh (lib/auth.ts).
  forgetUser(userId);
  return NextResponse.json({ ok: true, name });
});
