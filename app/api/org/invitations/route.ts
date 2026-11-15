import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authedRoute, parseBody, requireIdParam, enforceRateLimit, ApiError } from '@/lib/api';
import { inviteEmailSchema } from '@/lib/schemas';
import { inviteLimiter } from '@/lib/rate-limit';
import { generateInviteToken } from '@/lib/invite-tokens';

const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

export const GET = authedRoute(async (_req, { orgId }) => {
  // Tokens are never listed — the link is shown once, at creation.
  const { rows } = await getPool().query(
    `SELECT i.id, i.email, i.expires_at AS "expiresAt",
            i.accepted_at AS "acceptedAt", i.created_at AS "createdAt",
            u.name AS "invitedByName"
     FROM invitations i
     JOIN users u ON u.id = i.invited_by
     WHERE i.org_id = $1
     ORDER BY i.created_at DESC`,
    [orgId],
  );
  return NextResponse.json(rows);
});

export const POST = authedRoute(async (req, { orgId, userId }) => {
  await enforceRateLimit(inviteLimiter, orgId);
  const { email } = await parseBody(req, inviteEmailSchema);
  const normalizedEmail = email.toLowerCase().trim();
  const db = getPool();

  // Already a member of this org?
  const { rows: existingUsers } = await db.query(
    'SELECT id FROM users WHERE email = $1 AND org_id = $2',
    [normalizedEmail, orgId],
  );
  if (existingUsers.length > 0) {
    throw new ApiError(409, 'User is already a member of this organisation');
  }

  // Already has a live invitation?
  const { rows: existingInvites } = await db.query(
    `SELECT id FROM invitations
     WHERE org_id = $1 AND email = $2 AND accepted_at IS NULL AND expires_at > NOW()`,
    [orgId, normalizedEmail],
  );
  if (existingInvites.length > 0) {
    throw new ApiError(409, 'An invitation has already been sent to this email');
  }

  const { token, tokenHash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  await db.query(
    `INSERT INTO invitations (id, org_id, email, invited_by, token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [`inv_${crypto.randomUUID()}`, orgId, normalizedEmail, userId, tokenHash, expiresAt],
  );

  // The raw token is returned exactly once; only its hash is stored.
  return NextResponse.json({ ok: true, token, expiresAt });
});

export const DELETE = authedRoute(async (req, { orgId }) => {
  const id = requireIdParam(req.nextUrl.searchParams, 'id');
  await getPool().query('DELETE FROM invitations WHERE id = $1 AND org_id = $2', [id, orgId]);
  return NextResponse.json({ ok: true });
});
