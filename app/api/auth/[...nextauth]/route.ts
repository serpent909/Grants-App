import { NextRequest } from 'next/server';
import { handlers } from '@/lib/auth';
import { authLimiter, checkRateLimit, getClientIp } from '@/lib/rate-limit';

export const { GET } = handlers;

export async function POST(req: NextRequest) {
  const blocked = await checkRateLimit(authLimiter, getClientIp(req.headers));
  if (blocked) return blocked;
  return handlers.POST(req);
}
