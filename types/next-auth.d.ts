import 'next-auth';

declare module 'next-auth' {
  interface User {
    orgId?: string;
    orgName?: string;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      orgId: string;
      orgName: string;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    orgId?: string;
    orgName?: string;
    /** Epoch ms of the last time this token was checked against the users table. */
    checkedAt?: number;
    /** Epoch ms of the sign-in that created this session (compared with users.password_changed_at). */
    authAt?: number;
  }
}
