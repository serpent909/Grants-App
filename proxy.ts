import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  // CSRF: reject state-changing API requests from foreign origins
  const { method, nextUrl, headers } = request;
  if (
    nextUrl.pathname.startsWith('/api') &&
    (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH')
  ) {
    const origin = headers.get('origin');
    if (origin && origin !== `${nextUrl.protocol}//${nextUrl.host}`) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // Check for NextAuth session cookie (secure prefix on HTTPS)
  const token =
    request.cookies.get('authjs.session-token') ||
    request.cookies.get('__Secure-authjs.session-token');

  if (!token) {
    if (nextUrl.pathname.startsWith('/api')) {
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
