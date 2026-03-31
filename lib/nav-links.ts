/**
 * Shared utility: parse HTML navigation links to find grant-related pages.
 *
 * Used by:
 *   - enrich-with-tavily.ts (find grant page from funder homepage)
 *   - deep-search route (discover application forms, eligibility pages, etc.)
 *   - fill-missing-fields.ts (find subpages with missing grant details)
 */

const UA = 'Mozilla/5.0 (compatible; GrantSearchBot/1.0)';
const FETCH_TIMEOUT = 15_000;

/** Keywords that suggest a link points to a grants/funding page (not donation pages). */
const GRANT_LINK_PATTERNS = /\b(grants?|funding|what.we.fund|apply|application|eligib|criteria|guidelines|how.to.apply|deadlines?|rounds?)\b/i;

/** Keywords that indicate a link is about RECEIVING donations, not giving grants. */
const DONATION_LINK_PATTERNS = /\b(donate|donation|give.now|support.us|fundrais|make.a.gift|contribute)\b/i;

export interface NavLink {
  url: string;
  text: string;
  inNav: boolean;
}

/**
 * Fetch a page's HTML and extract all links matching grant-related keywords.
 * Returns links sorted by relevance (nav/header links first), resolved to absolute URLs.
 */
export async function findGrantLinksFromHtml(
  pageUrl: string,
): Promise<NavLink[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(pageUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!res.ok) return [];

    const html = await res.text();
    return parseGrantLinksFromHtml(html, pageUrl);
  } catch {
    return [];
  }
}

/**
 * Parse grant-related links from raw HTML string.
 * Useful when you already have the HTML (e.g. from a prior fetch).
 */
export function parseGrantLinksFromHtml(
  html: string,
  baseUrl: string,
): NavLink[] {
  const linkRegex = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const candidates: NavLink[] = [];

  // Identify nav/header blocks
  const navRegex = /<(?:nav|header)\b[^>]*>([\s\S]*?)<\/(?:nav|header)>/gi;
  const navBlocks: string[] = [];
  let navMatch;
  while ((navMatch = navRegex.exec(html)) !== null) {
    navBlocks.push(navMatch[1]);
  }

  const seen = new Set<string>();
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const href = linkMatch[1];
    const text = linkMatch[2].replace(/<[^>]+>/g, '').trim();
    const combined = `${href} ${text}`;

    if (!GRANT_LINK_PATTERNS.test(combined)) continue;
    // Skip links that look like donation/fundraising pages, not grant-giving pages
    if (DONATION_LINK_PATTERNS.test(combined) && !(/grants?/i.test(combined))) continue;

    // Resolve to absolute URL
    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }

    // Deduplicate by resolved URL
    if (seen.has(absolute)) continue;
    seen.add(absolute);

    // Skip external links, anchors, mailto, tel
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href === '#') continue;

    const inNav = navBlocks.some(block => block.includes(linkMatch![0]));
    candidates.push({ url: absolute, text, inNav });
  }

  // Sort: nav links first, then by text relevance
  candidates.sort((a, b) => (b.inNav ? 1 : 0) - (a.inNav ? 1 : 0));

  return candidates;
}

/**
 * Convenience: find the single best grant page URL from a homepage.
 * Returns null if no grant-related links are found.
 */
export async function findBestGrantPage(homepageUrl: string): Promise<string | null> {
  const links = await findGrantLinksFromHtml(homepageUrl);
  return links.length > 0 ? links[0].url : null;
}
