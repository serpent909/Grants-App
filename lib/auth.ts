import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { getPool } from './db';
import { loginSchema } from './schemas';

/**
 * How long a session token is trusted before the user is re-checked against
 * the database. Bounds how long a removed member (or a renamed org) can keep
 * using a stale JWT.
 */
const REVALIDATE_MS = 5 * 60 * 1000;

/**
 * A real bcrypt hash of a random throwaway value. Compared against when the
 * email is unknown so that login takes the same time whether or not the
 * account exists (prevents user enumeration by timing).
 */
const DUMMY_HASH = '$2b$12$zojWIC5/gsaLSuHyRHGxouCl234UfUNL4QGqS/YLhrORARJMNF6Bq';

interface UserSnapshot {
  orgId: string;
  orgName: string;
  name: string;
}

// Per-instance memo of recent user lookups, so a burst of API calls with a
// token that is due for revalidation costs one query rather than one each.
const LOOKUP_MEMO_MS = 60 * 1000;
const recentLookups = new Map<string, { at: number; user: UserSnapshot | null }>();

async function loadUser(userId: string): Promise<UserSnapshot | null> {
  const cached = recentLookups.get(userId);
  if (cached && Date.now() - cached.at < LOOKUP_MEMO_MS) return cached.user;

  const { rows } = await getPool().query<{ org_id: string; org_name: string; name: string }>(
    `SELECT u.org_id, u.name, o.name AS org_name
     FROM users u
     JOIN organisations o ON o.id = u.org_id
     WHERE u.id = $1`,
    [userId],
  );
  const user = rows[0]
    ? { orgId: rows[0].org_id, orgName: rows[0].org_name, name: rows[0].name }
    : null;

  if (recentLookups.size > 5000) recentLookups.clear();
  recentLookups.set(userId, { at: Date.now(), user });
  return user;
}

/** Drop a user from the lookup memo (call after removing them or changing their org). */
export function forgetUser(userId: string): void {
  recentLookups.delete(userId);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const { rows } = await getPool().query(
          `SELECT u.id, u.email, u.name, u.password_hash, u.org_id, o.name AS org_name
           FROM users u
           JOIN organisations o ON o.id = u.org_id
           WHERE u.email = $1`,
          [email.toLowerCase().trim()],
        );

        const user = rows[0];
        // Always run a bcrypt comparison, even for unknown emails.
        const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
        if (!user || !valid) return null;

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
    async jwt({ token, user, trigger }) {
      // Initial sign-in: copy identity + tenancy onto the token.
      if (user) {
        token.userId = user.id;
        token.orgId = user.orgId;
        token.orgName = user.orgName;
        token.checkedAt = Date.now();
        return token;
      }

      // Token fields are typed `unknown` by Auth.js — narrow before use.
      const userId = typeof token.userId === 'string' ? token.userId : null;
      if (!userId) return null;
      const checkedAt = typeof token.checkedAt === 'number' ? token.checkedAt : 0;

      // Confirm the user still exists and refresh org details — periodically,
      // and straight away when the client asks (e.g. after renaming the org).
      const forced = trigger === 'update';
      if (forced || Date.now() - checkedAt > REVALIDATE_MS) {
        try {
          if (forced) forgetUser(userId);
          const current = await loadUser(userId);
          if (!current) return null; // user removed — invalidate the session
          token.orgId = current.orgId;
          token.orgName = current.orgName;
          token.name = current.name;
          token.checkedAt = Date.now();
        } catch (err) {
          // Database blip: keep the existing session rather than logging everyone out.
          console.error('[auth] Session revalidation failed:', err);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.userId === 'string' && typeof token.orgId === 'string') {
        session.user.id = token.userId;
        session.user.orgId = token.orgId;
        session.user.orgName = typeof token.orgName === 'string' ? token.orgName : '';
      }
      return session;
    },
  },
});
