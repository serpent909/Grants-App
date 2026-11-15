import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

function getRedis() {
  // Vercel KV integration uses KV_REST_API_URL/TOKEN; standalone Upstash uses UPSTASH_REDIS_REST_URL/TOKEN
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const redis = getRedis();

function createLimiter(prefix: string, requests: number, window: Parameters<typeof Ratelimit.slidingWindow>[1]) {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, window),
    prefix: `rl:${prefix}`,
  });
}

// 5 login/invite-accept attempts per minute per IP
export const authLimiter = createLimiter('auth', 5, '1 m');

// 3 signups per hour per IP
export const signupLimiter = createLimiter('signup', 3, '1 h');

// 10 grant searches per hour per org
export const searchLimiter = createLimiter('search', 10, '1 h');

// 5 deep searches per hour per org (expensive)
export const deepSearchLimiter = createLimiter('deep-search', 5, '1 h');

// 20 file uploads per hour per org
export const uploadLimiter = createLimiter('upload', 20, '1 h');

// 10 invitations per hour per org
export const inviteLimiter = createLimiter('invite', 10, '1 h');

// "Forgot password" requests: 5 per 15 minutes per IP …
export const passwordResetIpLimiter = createLimiter('pw-reset-ip', 5, '15 m');

// … and 3 per hour per email address, so nobody's inbox can be flooded.
export const passwordResetEmailLimiter = createLimiter('pw-reset-email', 3, '1 h');

// 3 verification emails per hour per user (resend button)
export const verificationEmailLimiter = createLimiter('verify-email', 3, '1 h');

/**
 * Result of consulting a rate limiter.
 * - `ok`          the request is within its limit (always, outside production)
 * - `limited`     the limit is exceeded
 * - `unavailable` nothing is enforcing the limit: Redis is not configured,
 *                 or the call to it failed
 */
export interface RateLimitOutcome {
  state: 'ok' | 'limited' | 'unavailable';
  /** Seconds until the limit resets (only when `limited`). */
  retryAfterSeconds?: number;
}

let warnedUnconfigured = false;

export async function getRateLimitOutcome(
  limiter: Ratelimit | null,
  key: string,
): Promise<RateLimitOutcome> {
  if (process.env.NODE_ENV !== 'production') return { state: 'ok' }; // skip in dev/test
  if (!limiter) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.error(
        '[RateLimit] Redis is not configured (KV_REST_API_URL / KV_REST_API_TOKEN). ' +
        'Rate limiting is OFF, and everything that sends email is disabled until it is set.',
      );
    }
    return { state: 'unavailable' };
  }
  try {
    const { success, reset } = await limiter.limit(key);
    if (success) return { state: 'ok' };
    return { state: 'limited', retryAfterSeconds: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) };
  } catch (err) {
    console.error('[RateLimit] Redis error:', err);
    return { state: 'unavailable' };
  }
}

/**
 * Whether it is safe to send an email as a result of this request.
 *
 * Email goes out under our domain to an address the caller chose, so it is
 * only sent when a rate limit is actually being enforced. With no working
 * limiter, an endpoint that sends email is an open door for inbox flooding.
 */
export function canSendEmail(outcome: RateLimitOutcome): boolean {
  return outcome.state === 'ok';
}

/**
 * Check rate limit. Returns a 429 response if blocked, or null if allowed.
 *
 * By default this fails open: if Redis is not configured or errors, the
 * request is allowed. Pass `failClosed: true` for endpoints whose only job is
 * to send email — those get a 503 instead when nothing is enforcing the limit.
 */
export async function checkRateLimit(
  limiter: Ratelimit | null,
  key: string,
  options: { failClosed?: boolean } = {},
): Promise<Response | null> {
  const outcome = await getRateLimitOutcome(limiter, key);
  if (outcome.state === 'limited') {
    // The standard Response (not NextResponse) keeps this module free of Next.js
    // imports, so it can be unit tested with Node's test runner.
    return Response.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(outcome.retryAfterSeconds ?? 60) } },
    );
  }
  if (outcome.state === 'unavailable' && options.failClosed) {
    return Response.json(
      { error: 'This is temporarily unavailable. Please try again later.' },
      { status: 503 },
    );
  }
  return null;
}

/** Extract client IP from request headers (works behind Vercel/Cloudflare proxies) */
export function getClientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || headers.get('x-real-ip')
    || 'unknown';
}
