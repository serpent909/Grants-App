import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Check for NextAuth session cookie (secure prefix on HTTPS)
  const token =
    request.cookies.get('authjs.session-token') ||
    request.cookies.get('__Secure-authjs.session-token');

  if (!token) {
    if (request.nextUrl.pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|login|signup|invite|api/auth).*)',
  ],
};
