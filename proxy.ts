import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const isDev = process.env.NODE_ENV === 'development';

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // nonce allowlists Next.js's own inline scripts; strict-dynamic propagates trust to
    // scripts they load dynamically. unsafe-eval is only added in dev for Turbopack HMR.
    `script-src 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
    isDev ? "connect-src 'self' ws:" : "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const { method, nextUrl, headers } = request;

  // CSRF: reject state-changing API requests from foreign origins
  if (
    nextUrl.pathname.startsWith('/api') &&
    (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH')
  ) {
    const origin = headers.get('origin');
    if (origin && origin !== `${nextUrl.protocol}//${nextUrl.host}`) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Browsers that omit Origin still send Sec-Fetch-Site on cross-site requests.
    if (!origin && headers.get('sec-fetch-site') === 'cross-site') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // Auth check — skip for public routes
  const isPublic =
    nextUrl.pathname.startsWith('/login') ||
    nextUrl.pathname.startsWith('/signup') ||
    nextUrl.pathname.startsWith('/invite') ||
    nextUrl.pathname.startsWith('/api/auth');

  if (!isPublic) {
    const token =
      request.cookies.get('authjs.session-token') ||
      request.cookies.get('__Secure-authjs.session-token');

    if (!token) {
      if (nextUrl.pathname.startsWith('/api')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      // Remember where the user was heading so login can send them back.
      const loginUrl = new URL('/login', request.url);
      const destination = `${nextUrl.pathname}${nextUrl.search}`;
      if (destination !== '/') loginUrl.searchParams.set('next', destination);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Generate a per-request nonce and attach CSP + x-nonce header
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', buildCsp(nonce));
  return response;
}

export const config = {
  // Cover all routes; exclude only Next.js internals and static assets.
  // Public files must be excluded too: the login page needs /theme.js before
  // the visitor has a session, and without this it was redirected to /login.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|theme\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
