/**
 * Browser-side fetch helper for the app's own JSON API.
 *
 * Every API route returns `{ error: string }` on failure. `apiFetch` turns a
 * non-2xx response into a thrown `ApiRequestError` carrying that message, so
 * callers (and SWR) see failures instead of silently treating them as "no data".
 */

export class ApiRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

const AUTH_PAGES = ['/login', '/signup', '/invite'];

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (AUTH_PAGES.some(p => pathname.startsWith(p))) return;
  const next = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  window.location.assign(`/login${next}`);
}

export async function apiFetch<T = unknown>(input: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    throw new ApiRequestError(0, 'Network error — check your connection and try again.');
  }

  if (res.status === 401) {
    // Session expired or revoked — send the user back through login.
    redirectToLogin();
    throw new ApiRequestError(401, 'Your session has expired. Please sign in again.');
  }

  if (!res.ok) {
    let message = 'Something went wrong. Please try again.';
    try {
      const data = await res.json();
      if (data && typeof data.error === 'string') message = data.error;
    } catch { /* non-JSON error body */ }
    throw new ApiRequestError(res.status, message);
  }

  return res.json() as Promise<T>;
}

/** Build a JSON request init: `apiFetch(url, json('POST', body))`. */
export function json(method: 'POST' | 'PUT' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
