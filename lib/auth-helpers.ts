import { auth } from './auth';

export interface AuthSession {
  userId: string;
  orgId: string;
  orgName: string;
  email: string;
  name: string;
}

/**
 * Get the authenticated user's org ID from the session.
 * Throws if unauthenticated — callers should catch and return 401.
 */
export async function getAuthSession(): Promise<AuthSession> {
  const session = await auth();
  const user = session?.user as Record<string, unknown> | undefined;

  if (!user?.id || !user?.orgId) {
    throw new Error('Unauthorized');
  }

  return {
    userId: user.id as string,
    orgId: user.orgId as string,
    orgName: (user.orgName as string) || '',
    email: (user.email as string) || '',
    name: (user.name as string) || '',
  };
}

/**
 * Shorthand to get just the org ID. Throws if unauthenticated.
 */
export async function getOrgId(): Promise<string> {
  const session = await getAuthSession();
  return session.orgId;
}
