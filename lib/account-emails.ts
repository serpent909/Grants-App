import { getPool, withTransaction } from './db';
import { sendEmail, type EmailOutcome } from './email';
import { passwordResetEmail, verifyEmailEmail, invitationEmail } from './email-templates';
import {
  generateAuthToken, PASSWORD_RESET_TTL_MS, EMAIL_VERIFICATION_TTL_MS,
} from './auth-tokens';

/**
 * The account emails: each creates whatever token the link needs, then sends.
 * `appUrl` is the trusted base URL from `getAppUrl()` (lib/app-url.ts).
 */

/**
 * Email a password-reset link if (and only if) the address belongs to an
 * account. Callers must respond identically either way — run this after the
 * response has been sent (`after()`), so neither the reply nor its timing
 * reveals whether the email is registered.
 */
export async function sendPasswordResetEmail(email: string, appUrl: string): Promise<void> {
  const { rows } = await getPool().query<{ id: string; email: string }>(
    'SELECT id, email FROM users WHERE email = $1',
    [email],
  );
  const user = rows[0];
  if (!user) return;

  const { token, tokenHash } = generateAuthToken();
  await withTransaction(async client => {
    // Housekeeping: spent and expired tokens for this user are of no further use.
    await client.query(
      'DELETE FROM password_reset_tokens WHERE user_id = $1 AND (used_at IS NOT NULL OR expires_at < NOW())',
      [user.id],
    );
    await client.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [`prt_${crypto.randomUUID()}`, user.id, tokenHash, new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString()],
    );
  });

  await sendEmail({
    to: user.email,
    ...passwordResetEmail({ url: `${appUrl}/reset-password/${token}` }),
  });
}

/** Create a verification token for a user and email them the link. */
export async function sendVerificationEmail(
  user: { id: string; email: string },
  appUrl: string,
): Promise<EmailOutcome> {
  const { token, tokenHash } = generateAuthToken();
  await withTransaction(async client => {
    await client.query(
      'DELETE FROM email_verification_tokens WHERE user_id = $1 AND (used_at IS NOT NULL OR expires_at < NOW())',
      [user.id],
    );
    await client.query(
      `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [`evt_${crypto.randomUUID()}`, user.id, tokenHash, new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString()],
    );
  });

  return sendEmail({
    to: user.email,
    ...verifyEmailEmail({ url: `${appUrl}/verify-email/${token}` }),
  });
}

/** Email an invitation link. The invitation row is created by the caller. */
export async function sendInvitationEmail(
  invite: { email: string; token: string; orgName: string; inviterName: string },
  appUrl: string,
): Promise<EmailOutcome> {
  return sendEmail({
    to: invite.email,
    ...invitationEmail({
      url: `${appUrl}/invite/${invite.token}`,
      orgName: invite.orgName,
      inviterName: invite.inviterName,
    }),
  });
}
