import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

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

/**
 * Check rate limit. Returns a 429 response if blocked, or null if allowed.
 * Gracefully passes through if Redis is not configured.
 */
export async function checkRateLimit(
  limiter: Ratelimit | null,
  key: string,
): Promise<NextResponse | null> {
  if (!limiter) return null; // Redis not configured — allow through
  try {
    const { success, reset } = await limiter.limit(key);
    if (!success) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)) },
        },
      );
    }
    return null;
  } catch (err) {
    // If Redis fails, don't block the request
    console.error('[RateLimit] Redis error, allowing request:', err);
    return null;
  }
}

/** Extract client IP from request headers (works behind Vercel/Cloudflare proxies) */
export function getClientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || headers.get('x-real-ip')
    || 'unknown';
}
