import { NextRequest, NextResponse } from 'next/server';
import type { Ratelimit } from '@upstash/ratelimit';
import type { z } from 'zod';
import { getAuthSession, type AuthSession } from './auth-helpers';
import { ApiError } from './errors';
import { checkRateLimit } from './rate-limit';
import { parseOrError } from './schemas';

export { ApiError };

/** Consistent error shape for every API response: `{ error: string }`. */
export function jsonError(message: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ error: message }, { status, headers });
}

function toErrorResponse(err: unknown, label: string): Response {
  if (err instanceof ApiError) return jsonError(err.message, err.status, err.headers);
  // Unexpected failure — log the detail, never leak it to the client.
  console.error(`[api] ${label} failed:`, err);
  return jsonError('Something went wrong. Please try again.', 500);
}

function label(req: NextRequest): string {
  return `${req.method} ${req.nextUrl.pathname}`;
}

/**
 * Wrap an authenticated route handler.
 * - Resolves the session (401 `{ error }` if missing/invalid)
 * - Converts thrown ApiErrors into JSON responses
 * - Logs and masks anything unexpected as a generic 500
 */
export function authedRoute(
  handler: (req: NextRequest, session: AuthSession) => Promise<Response>,
) {
  return async (req: NextRequest): Promise<Response> => {
    try {
      const session = await getAuthSession();
      return await handler(req, session);
    } catch (err) {
      return toErrorResponse(err, label(req));
    }
  };
}

/** Wrap an unauthenticated route handler with the same error handling. */
export function publicRoute(handler: (req: NextRequest) => Promise<Response>) {
  return async (req: NextRequest): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      return toErrorResponse(err, label(req));
    }
  };
}

/** Parse + validate a JSON body against a zod schema. Throws ApiError(400). */
export async function parseBody<T>(req: Request, schema: z.ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, 'Invalid request');
  }
  const parsed = parseOrError(schema, raw);
  if ('error' in parsed) throw new ApiError(400, 'Invalid request');
  return parsed.data;
}

const ID_PATTERN = /^[\w.:-]{1,100}$/;

/** Read a required ID-like query parameter. Throws ApiError(400) if absent/malformed. */
export function requireIdParam(searchParams: URLSearchParams, name: string): string {
  const value = searchParams.get(name);
  if (!value || !ID_PATTERN.test(value)) throw new ApiError(400, `${name} required`);
  return value;
}

/** Read an optional ID-like query parameter (null when absent). Throws on malformed values. */
export function optionalIdParam(searchParams: URLSearchParams, name: string): string | null {
  const value = searchParams.get(name);
  if (value === null || value === '') return null;
  if (!ID_PATTERN.test(value)) throw new ApiError(400, `Invalid ${name}`);
  return value;
}

/** Parse a comma-separated ID list query parameter, dropping malformed entries. */
export function parseIdList(value: string | null, max = 500): string[] {
  if (!value) return [];
  const ids = value.split(',').filter(id => ID_PATTERN.test(id));
  if (ids.length > max) throw new ApiError(400, 'Too many ids');
  return ids;
}

/** Enforce a rate limit; throws ApiError(429) with Retry-After when exceeded. */
export async function enforceRateLimit(limiter: Ratelimit | null, key: string): Promise<void> {
  const blocked = await checkRateLimit(limiter, key);
  if (!blocked) return;
  const retryAfter = blocked.headers.get('Retry-After');
  throw new ApiError(
    429,
    'Too many requests. Please try again later.',
    retryAfter ? { 'Retry-After': retryAfter } : undefined,
  );
}
