import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { getPool } from './db';
import { loginSchema } from './schemas';
import { isSessionStale } from './auth-tokens';

/**
 * How long a session token is trusted before the user is re-checked against
 * the database. Bounds how long a removed member (or a renamed org, or a
 * session that predates a password change) can keep using a stale JWT.
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
  /** Epoch ms of the last password change/reset, or null if never changed. */
  passwordChangedAt: number | null;
}

// Per-instance memo of recent user lookups, so a burst of API calls with a
// token that is due for revalidation costs one query rather than one each.
const LOOKUP_MEMO_MS = 60 * 1000;
const recentLookups = new Map<string, { at: number; user: UserSnapshot | null }>();

interface UserRow {
  org_id: string;
  org_name: string;
  name: string;
  password_changed_at?: Date | string | null;
}

/** Postgres "undefined_column" — the column a query names does not exist. */
const UNDEFINED_COLUMN = '42703';
let warnedMissingColumn = false;

async function queryUser(userId: string): Promise<UserRow | undefined> {
  const select = (columns: string) =>
    getPool().query<UserRow>(
      `SELECT ${columns}, o.name AS org_name
       FROM users u
       JOIN organisations o ON o.id = u.org_id
       WHERE u.id = $1`,
      [userId],
    );

  try {
    return (await select('u.org_id, u.name, u.password_changed_at')).rows[0];
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== UNDEFINED_COLUMN) throw err;
    // migrations/008_email_flows.sql has not been applied. Without this
    // fallback the query would fail on every check and — because a failed check
    // keeps the session — removed members would never be signed out. Carry on
    // without the password-change check, and say so loudly.
    if (!warnedMissingColumn) {
      warnedMissingColumn = true;
      console.error(
        '[auth] users.password_changed_at is missing — run migrations/008_email_flows.sql. ' +
        'Until then, changing a password will not sign out other sessions.',
      );
    }
    return (await select('u.org_id, u.name')).rows[0];
  }
}

async function loadUser(userId: string): Promise<UserSnapshot | null> {
  const cached = recentLookups.get(userId);
  if (cached && Date.now() - cached.at < LOOKUP_MEMO_MS) return cached.user;

  const row = await queryUser(userId);
  const user: UserSnapshot | null = row
    ? {
        orgId: row.org_id,
        orgName: row.org_name,
        name: row.name,
        passwordChangedAt: row.password_changed_at ? new Date(row.password_changed_at).getTime() : null,
      }
    : null;

  if (recentLookups.size > 5000) recentLookups.clear();
  recentLookups.set(userId, { at: Date.now(), user });
  return user;
}

/** Drop a user from the lookup memo (call after removing them, changing their org or their password). */
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
        // When this session signed in. Auth.js re-stamps `iat` every time it
        // re-issues the cookie, so that cannot be used for this.
        //
        // Never earlier than the last password change: both are stamped by the
        // app clock, possibly on different servers. Without this, a sign-in
        // moments after a change — on a server whose clock runs slightly behind
        // — would look older than the change and be signed out at its next check.
        let authAt = Date.now();
        if (user.id) {
          try {
            forgetUser(user.id); // read the current row, not a memoised one
            const current = await loadUser(user.id);
            if (current?.passwordChangedAt) authAt = Math.max(authAt, current.passwordChangedAt);
          } catch (err) {
            console.error('[auth] Could not read password_changed_at at sign-in:', err);
          }
        }
        token.authAt = authAt;
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
          // Password changed or reset since this session signed in — sign it out.
          const authAt = typeof token.authAt === 'number' ? token.authAt : null;
          if (isSessionStale(authAt, current.passwordChangedAt)) return null;
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
