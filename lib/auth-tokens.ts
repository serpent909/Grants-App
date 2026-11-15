import { createHash, randomBytes } from 'crypto';

/**
 * Single-use tokens sent by email (password reset, email verification).
 *
 * Like invitation tokens (lib/invite-tokens.ts) these are bearer credentials,
 * so only a SHA-256 digest is stored. The raw token exists in exactly one
 * place: the link inside the email.
 */

/** Password reset links are valid for one hour. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/** Email verification links are valid for 24 hours. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export function generateAuthToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashAuthToken(token) };
}

export function hashAuthToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Rate-limit key for an email address: normalised, then hashed so addresses
 * are not stored in the rate-limit store.
 */
export function emailRateLimitKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

/**
 * Should a session be rejected because the password changed after it signed in?
 *
 * `signedInAt` is the epoch-ms time of the sign-in that created the session
 * (`token.authAt`); `passwordChangedAt` is `users.password_changed_at` as epoch
 * ms, or null if the password has never been changed. Sessions created before
 * `authAt` existed carry no sign-in time and are treated as older than any
 * password change.
 */
export function isSessionStale(
  signedInAt: number | null | undefined,
  passwordChangedAt: number | null | undefined,
): boolean {
  if (passwordChangedAt == null || !Number.isFinite(passwordChangedAt)) return false;
  if (signedInAt == null || !Number.isFinite(signedInAt)) return true;
  return signedInAt < passwordChangedAt;
}
