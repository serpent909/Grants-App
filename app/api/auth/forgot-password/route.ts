import { NextResponse, after } from 'next/server';
import { publicRoute, parseBody, enforceRateLimit } from '@/lib/api';
import { forgotPasswordSchema } from '@/lib/schemas';
import { passwordResetIpLimiter, passwordResetEmailLimiter, getClientIp } from '@/lib/rate-limit';
import { emailRateLimitKey } from '@/lib/auth-tokens';
import { getAppUrl } from '@/lib/app-url';
import { sendPasswordResetEmail } from '@/lib/account-emails';

/**
 * Request a password-reset email.
 *
 * The reply is the same whether or not the address belongs to an account. The
 * lookup, token and email all happen after the response has been sent, so the
 * response time does not reveal it either.
 */
export const POST = publicRoute(async req => {
  // This endpoint exists only to send email, so it fails closed: with no working
  // rate limiter it answers 503 (for every address alike) rather than letting
  // anyone flood an inbox.
  await enforceRateLimit(passwordResetIpLimiter, getClientIp(req.headers), { failClosed: true });

  const { email } = await parseBody(req, forgotPasswordSchema);
  const normalizedEmail = email.toLowerCase().trim();

  // Per-address limit applies to any address, registered or not.
  await enforceRateLimit(passwordResetEmailLimiter, emailRateLimitKey(normalizedEmail), { failClosed: true });

  const appUrl = getAppUrl(req.nextUrl.origin);

  after(async () => {
    try {
      await sendPasswordResetEmail(normalizedEmail, appUrl);
    } catch (err) {
      console.error('[auth] Password reset email failed:', err);
    }
  });

  return NextResponse.json({ ok: true });
});
