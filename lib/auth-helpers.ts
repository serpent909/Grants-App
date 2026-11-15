import { auth } from './auth';
import { ApiError } from './errors';

export interface AuthSession {
  userId: string;
  orgId: string;
  orgName: string;
  email: string;
  name: string;
}

/**
 * Get the authenticated user's session.
 * Throws ApiError(401) if unauthenticated — route handlers wrapped with
 * `authedRoute` (lib/api.ts) turn that into a `{ error }` JSON response.
 */
export async function getAuthSession(): Promise<AuthSession> {
  const session = await auth();
  const user = session?.user;

  if (!user?.id || !user.orgId) {
    throw new ApiError(401, 'Unauthorized');
  }

  return {
    userId: user.id,
    orgId: user.orgId,
    orgName: user.orgName || '',
    email: user.email || '',
    name: user.name || '',
  };
}

/**
 * Shorthand to get just the org ID. Throws ApiError(401) if unauthenticated.
 */
export async function getOrgId(): Promise<string> {
  const session = await getAuthSession();
  return session.orgId;
}
