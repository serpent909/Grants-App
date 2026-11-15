import { NextRequest } from 'next/server';
import { handlers } from '@/lib/auth';
import { authLimiter, checkRateLimit, getClientIp } from '@/lib/rate-limit';

export const { GET } = handlers;

export async function POST(req: NextRequest) {
  // Only credential submissions are throttled — sign-out and session refresh
  // must never be blocked by a login-attempt limit.
  if (req.nextUrl.pathname.includes('/callback/')) {
    const blocked = await checkRateLimit(authLimiter, getClientIp(req.headers));
    if (blocked) return blocked;
  }
  return handlers.POST(req);
}
