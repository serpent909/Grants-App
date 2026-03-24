import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { getPool } from './db';

export const { handlers, signIn, signOut, auth } = NextAuth({
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const db = getPool();
        const { rows } = await db.query(
          `SELECT u.id, u.email, u.name, u.password_hash, u.org_id, o.name AS org_name
           FROM users u
           JOIN organisations o ON o.id = u.org_id
           WHERE u.email = $1`,
          [email.toLowerCase().trim()],
        );

        if (rows.length === 0) return null;

        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          orgId: user.org_id,
          orgName: user.org_name,
        };
      },
    }),
  ],
  callbacks: {
    async authorized({ auth: session, request }) {
      const isLoggedIn = !!session?.user;
      const isApiRoute = request.nextUrl.pathname.startsWith('/api');

      if (!isLoggedIn) {
        if (isApiRoute) {
          // API routes: return false → NextAuth returns 401
          return false;
        }
        // Pages: redirect to login
        return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      // On initial sign-in, user object is present
      if (user) {
        token.userId = user.id;
        token.orgId = (user as Record<string, unknown>).orgId as string;
        token.orgName = (user as Record<string, unknown>).orgName as string;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        (session.user as unknown as Record<string, unknown>).orgId = token.orgId;
        (session.user as unknown as Record<string, unknown>).orgName = token.orgName;
      }
      return session;
    },
  },
});
