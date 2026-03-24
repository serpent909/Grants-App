export { auth as middleware } from '@/lib/auth';

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - login, signup, invite pages (public)
     * - api/auth/* (NextAuth routes)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|login|signup|invite|api/auth).*)',
  ],
};
