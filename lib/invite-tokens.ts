import { createHash, randomBytes } from 'crypto';

/**
 * Invitation tokens are bearer credentials, so only a SHA-256 digest is stored.
 * The raw token exists in exactly one place: the link shown to the inviter.
 */
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Values to match against `invitations.token`: the digest (current scheme) and
 * the raw token (invitations created before hashing was introduced — these
 * expire within 48 hours, after which the raw match can be removed).
 */
export function inviteTokenCandidates(token: string): string[] {
  return [hashInviteToken(token), token];
}
