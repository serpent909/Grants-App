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
  }
}
