import { NextResponse } from 'next/server';
import { getPool, withTransaction } from '@/lib/db';
import { authedRoute, requireIdParam, ApiError } from '@/lib/api';
import { forgetUser } from '@/lib/auth';

export const GET = authedRoute(async (_req, { orgId }) => {
  const { rows } = await getPool().query(
    `SELECT id, email, name, created_at AS "createdAt"
     FROM users WHERE org_id = $1 ORDER BY created_at`,
    [orgId],
  );
  return NextResponse.json(rows);
});

export const DELETE = authedRoute(async (req, { orgId, userId: currentUserId }) => {
  const userId = requireIdParam(req.nextUrl.searchParams, 'userId');

  if (userId === currentUserId) throw new ApiError(400, 'Cannot remove yourself');

  const removed = await withTransaction(async client => {
    // Invitations reference their inviter, so they must go first or the delete
    // fails on the foreign key. Pending invites from a removed member are revoked.
    await client.query(
      'DELETE FROM invitations WHERE invited_by = $1 AND org_id = $2',
      [userId, orgId],
    );
    const { rowCount } = await client.query(
      'DELETE FROM users WHERE id = $1 AND org_id = $2',
      [userId, orgId],
    );
    return rowCount ?? 0;
  });

  if (removed === 0) throw new ApiError(404, 'Member not found');

  // Their session token is rejected on its next revalidation (see lib/auth.ts).
  forgetUser(userId);
  return NextResponse.json({ ok: true });
});
