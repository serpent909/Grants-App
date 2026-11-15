/**
 * Error type for expected API failures (bad input, unauthenticated, not found…).
 * Thrown anywhere inside a route handler wrapped by `authedRoute`/`publicRoute`
 * (see lib/api.ts) and converted to a `{ error: string }` JSON response.
 *
 * Anything that is NOT an ApiError is treated as unexpected: it is logged
 * server-side and the client only ever sees a generic 500 message.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
