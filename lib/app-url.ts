/**
 * The public base URL used for links inside emails.
 *
 * In production this must come from configuration, never from the incoming
 * request: an attacker who can influence the Host header could otherwise have
 * a password-reset link for someone else's account point at their own site.
 */

function normalise(value: string | undefined): string | null {
  if (!value) return null;
  const candidate = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
  try {
    const { protocol, host } = new URL(candidate);
    if (protocol !== 'https:' && protocol !== 'http:') return null;
    return `${protocol}//${host}`;
  } catch {
    return null;
  }
}

export function resolveAppUrl(options: {
  /** APP_URL — e.g. https://grants.example.org.nz */
  configured?: string;
  /** VERCEL_PROJECT_PRODUCTION_URL — host only, set automatically on Vercel. */
  vercelProductionHost?: string;
  /** Origin of the current request; only trusted outside production. */
  requestOrigin?: string;
  isProduction: boolean;
}): string {
  const fromConfig = normalise(options.configured) ?? normalise(options.vercelProductionHost);
  if (fromConfig) return fromConfig;

  if (!options.isProduction) {
    const fromRequest = normalise(options.requestOrigin);
    if (fromRequest) return fromRequest;
    return 'http://localhost:3000';
  }

  throw new Error('APP_URL is not set — it is required in production to build links in emails');
}

/** Base URL for email links, resolved from the environment (and the request in development). */
export function getAppUrl(requestOrigin?: string): string {
  return resolveAppUrl({
    configured: process.env.APP_URL,
    vercelProductionHost: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    requestOrigin,
    isProduction: process.env.NODE_ENV === 'production',
  });
}
