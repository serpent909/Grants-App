/**
 * SSRF protection for any server-side fetch of a URL we did not author
 * (grant pages, funder homepages, links discovered in HTML or by an LLM).
 *
 * Three layers:
 *   1. isSafeUrl()        — cheap syntactic check (https only, no credentials,
 *                           no private/loopback/link-local literals, no internal names)
 *   2. resolvesToPublic() — DNS check so a public-looking name cannot point at a
 *                           private address
 *   3. safeFetch()        — follows redirects manually, re-validating every hop,
 *                           with a timeout and a response size cap
 *
 * Known limitation: there is a small window between the DNS check and the
 * connection (DNS rebinding). Acceptable here because responses are only parsed
 * for links and are never returned verbatim to the caller.
 */
import { lookup } from 'dns/promises';
import { isIP } from 'net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
]);

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp'];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||                          // "this" network
    a === 10 ||                         // RFC1918
    a === 127 ||                        // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||         // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) ||         // RFC1918
    (a === 192 && b === 0) ||           // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224                            // multicast + reserved
  );
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  // IPv4-mapped (::ffff:a.b.c.d) — judge by the embedded IPv4 address
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (lower.startsWith('::ffff:')) return true; // hex-form mapped address — refuse
  return (
    /^f[cd]/.test(lower) ||   // fc00::/7 unique local
    /^fe[89ab]/.test(lower) || // fe80::/10 link-local
    lower.startsWith('ff')     // multicast
  );
}

/** True for loopback, private, link-local and otherwise non-routable addresses. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // not an IP at all — treat as unsafe
}

/**
 * Syntactic check: is this a public https URL we are willing to fetch or
 * hand to a third-party extractor? Does not perform DNS resolution.
 */
export function isSafeUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== '443') return false;

  // URL.hostname keeps the brackets on IPv6 literals; the WHATWG parser already
  // normalises decimal/hex/octal IPv4 forms (e.g. https://2130706433) to dotted quads.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname) return false;
  if (BLOCKED_HOSTNAMES.has(hostname)) return false;
  if (BLOCKED_SUFFIXES.some(s => hostname.endsWith(s))) return false;
  if (isIP(hostname)) return !isPrivateAddress(hostname);
  // Single-label hostnames ("intranet") only resolve on internal networks
  if (!hostname.includes('.')) return false;
  return true;
}

/** DNS check: every address the hostname resolves to must be public. */
export async function resolvesToPublic(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return !isPrivateAddress(host);
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every(a => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  /** Maximum response body size in bytes (default 2 MB). */
  maxBytes?: number;
}

/**
 * fetch() replacement for untrusted URLs. Validates the URL and every redirect
 * hop, enforces a timeout, and buffers at most `maxBytes` of the body.
 * Throws on any violation — callers should treat a throw as "could not fetch".
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = 15_000, maxRedirects = 3, maxBytes = 2 * 1024 * 1024 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let url = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (!isSafeUrl(url)) throw new Error('Blocked URL');
      if (!(await resolvesToPublic(new URL(url).hostname))) throw new Error('Blocked host');

      const res = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new Error('Redirect without location');
        url = new URL(location, url).toString();
        continue;
      }

      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > maxBytes) throw new Error('Response too large');

      // Buffer the body with a hard cap so a hostile server cannot exhaust memory.
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (res.body) {
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            throw new Error('Response too large');
          }
          chunks.push(value);
        }
      }
      // The body is already decoded, so only carry the content type across.
      const headers = new Headers();
      const contentType = res.headers.get('content-type');
      if (contentType) headers.set('content-type', contentType);
      return new Response(Buffer.concat(chunks), { status: res.status, headers });
    }
    throw new Error('Too many redirects');
  } finally {
    clearTimeout(timer);
  }
}
