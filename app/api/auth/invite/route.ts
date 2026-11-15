import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getPool, withTransaction, isUniqueViolation } from '@/lib/db';
import { publicRoute, parseBody, enforceRateLimit, ApiError } from '@/lib/api';
import { acceptInviteSchema } from '@/lib/schemas';
import { authLimiter, getClientIp } from '@/lib/rate-limit';
import { inviteTokenCandidates } from '@/lib/invite-tokens';

// GET: validate token and return org info
export const GET = publicRoute(async req => {
  await enforceRateLimit(authLimiter, getClientIp(req.headers));

  const token = req.nextUrl.searchParams.get('token');
  if (!token || token.length > 200) throw new ApiError(400, 'token required');

  const { rows } = await getPool().query(
    `SELECT i.email, i.expires_at, i.accepted_at, o.name AS org_name
     FROM invitations i
     JOIN organisations o ON o.id = i.org_id
     WHERE i.token = ANY($1::text[])`,
    [inviteTokenCandidates(token)],
  );

  const invite = rows[0];
  if (!invite) throw new ApiError(404, 'Invalid invitation link');
  if (invite.accepted_at) throw new ApiError(410, 'This invitation has already been used');
  if (new Date(invite.expires_at) < new Date()) throw new ApiError(410, 'This invitation has expired');

  return NextResponse.json({ email: invite.email, orgName: invite.org_name });
});

// POST: accept invitation — create user and join org
export const POST = publicRoute(async req => {
  await enforceRateLimit(authLimiter, getClientIp(req.headers));

  const { token, name, password } = await parseBody(req, acceptInviteSchema);
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const email = await withTransaction(async client => {
      // Claim the invitation atomically: of two concurrent requests with the
      // same token, only one gets a row back.
      const { rows } = await client.query<{ org_id: string; email: string }>(
        `UPDATE invitations SET accepted_at = NOW()
         WHERE token = ANY($1::text[]) AND accepted_at IS NULL AND expires_at > NOW()
         RETURNING org_id, email`,
        [inviteTokenCandidates(token)],
      );
      const invite = rows[0];
      if (!invite) throw new ApiError(410, 'This invitation is invalid, expired, or has already been used');

      const { rows: existingUsers } = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [invite.email],
      );
      if (existingUsers.length > 0) {
        throw new ApiError(409, 'An account with this email already exists');
      }

      await client.query(
        `INSERT INTO users (id, email, password_hash, name, org_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [`usr_${crypto.randomUUID()}`, invite.email, passwordHash, name.trim() || 'User', invite.org_id],
      );
      return invite.email;
    });

    return NextResponse.json({ ok: true, email });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, 'An account with this email already exists');
    throw err;
  }
});
