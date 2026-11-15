import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authedRoute, enforceRateLimit, ApiError } from '@/lib/api';
import { verificationEmailLimiter } from '@/lib/rate-limit';
import { getAppUrl } from '@/lib/app-url';
import { sendVerificationEmail } from '@/lib/account-emails';

async function loadAccount(userId: string, orgId: string) {
  const { rows } = await getPool().query<{ email: string; email_verified: Date | null }>(
    'SELECT email, email_verified FROM users WHERE id = $1 AND org_id = $2',
    [userId, orgId],
  );
  if (rows.length === 0) throw new ApiError(401, 'Unauthorized');
  return rows[0];
}

/** Has the signed-in user confirmed their email address? */
export const GET = authedRoute(async (_req, { userId, orgId }) => {
  const account = await loadAccount(userId, orgId);
  return NextResponse.json({ email: account.email, verified: account.email_verified !== null });
});

/** Send the verification email again. */
export const POST = authedRoute(async (req, { userId, orgId }) => {
  // Sends email, so it fails closed when no rate limiter is working.
  await enforceRateLimit(verificationEmailLimiter, userId, { failClosed: true });

  const account = await loadAccount(userId, orgId);
  if (account.email_verified !== null) return NextResponse.json({ ok: true, verified: true });

  try {
    await sendVerificationEmail({ id: userId, email: account.email }, getAppUrl(req.nextUrl.origin));
  } catch (err) {
    console.error('[account] Verification email failed:', err);
    throw new ApiError(503, 'We could not send the email just now. Please try again later.');
  }
  return NextResponse.json({ ok: true, verified: false });
});
