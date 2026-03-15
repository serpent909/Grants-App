/**
 * Thin wrapper around the Serper.dev Google Search API.
 * Returns the same { results: [{ url, content }] } shape used throughout
 * the pipeline so call sites need minimal changes from the Tavily search client.
 */

export interface SerperSearchOptions {
  /** Number of results to return (max 100). Default 10. */
  num?: number;
  /** ISO 3166-1 alpha-2 country code for geo-localised results e.g. 'nz', 'au'. */
  gl?: string;
  /** Domains to exclude from results (filtered client-side). */
  excludeDomains?: string[];
  /** Restrict to pages indexed in the past ~13 months (maps to Google tbs=qdr:y). */
  recentOnly?: boolean;
}

export interface SerperResult {
  url: string;
  content: string; // search snippet
}

export async function serperSearch(
  query: string,
  options: SerperSearchOptions = {},
): Promise<{ results: SerperResult[] }> {
  const { num = 10, gl, excludeDomains = [], recentOnly = false } = options;

  const body: Record<string, unknown> = { q: query, num };
  if (gl) body.gl = gl;
  if (recentOnly) body.tbs = 'qdr:y'; // past ~12 months

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY || '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Serper API error ${res.status}: ${await res.text().catch(() => '')}`);
  }

  const data = await res.json();
  const organic: Array<{ link: string; snippet?: string }> = data.organic || [];

  const results = organic
    .filter(r => {
      if (!excludeDomains.length) return true;
      try {
        const host = new URL(r.link).hostname.toLowerCase();
        return !excludeDomains.some(d => host === d || host.endsWith(`.${d}`));
      } catch { return false; }
    })
    .map(r => ({ url: r.link, content: r.snippet || '' }));

  return { results };
}
