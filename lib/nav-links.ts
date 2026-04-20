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
const GRANT_LINK_PATTERNS = /\b(grants?|funding|what.we.fund|eligib|criteria|guidelines|how.to.apply|community.invest|what.we.support|p[uū]tea|tautoko|[aā]whina|tono)\b/i;

/** Keywords that indicate a link is about RECEIVING donations, not giving grants. */
const DONATION_LINK_PATTERNS = /\b(donate|donation|give.now|support.us|fundrais|make.a.gift|contribute)\b/i;

/** URL path segments that indicate the page is NOT a grants page. */
const JUNK_PATH_PATTERNS = /\/(news|blog|posts?|articles?|careers?|jobs?|vacancies|contact|shop|store|cart|products?|login|signup|newsletter|cafe|restaurant|menu|faq|events?|gallery|media)\b/i;

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

    // Skip URLs with paths that indicate non-grant pages (news, blog, careers, etc.)
    if (JUNK_PATH_PATTERNS.test(new URL(absolute).pathname)) continue;

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

/** Parent nav patterns — intermediate pages that might contain grant links at the next level. */
const PARENT_NAV_PATTERNS = /\b(what.we.do|about.us|our.work|community|support|services|programmes?|invest|get.involved|our.impact|mahi|ratonga)\b/i;

/**
 * Broader patterns for detail/application pages.
 * Used as a retry when initial nav discovery yields no grants — catches things like
 * "Apply for funds", "Funding round open", "How to apply", application forms, etc.
 */
const DETAIL_LINK_PATTERNS = /\b(apply|application|funding|fund|funds|grants?|round|scheme|programmes?|eligib|criteria|guidelines?|deadline|how.to|open.for|closing|tono|kaupapa|p[uū]tea|tautoko)\b/i;

/**
 * Parse same-domain detail/application links from HTML using a broader pattern set.
 * Differs from parseGrantLinksFromHtml in that it:
 *   - matches broader keywords (apply, application, fund, etc.)
 *   - restricts to same-domain links only (we only want to crawl the funder's own site)
 *   - returns all matches, not just nav-block links
 */
export function parseDetailLinksFromHtml(
  html: string,
  baseUrl: string,
): NavLink[] {
  let baseHost: string;
  try {
    baseHost = new URL(baseUrl).hostname;
  } catch { return []; }

  const linkRegex = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const candidates: NavLink[] = [];
  const seen = new Set<string>();

  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const href = linkMatch[1];
    const text = linkMatch[2].replace(/<[^>]+>/g, '').trim();
    const combined = `${href} ${text}`;

    if (!DETAIL_LINK_PATTERNS.test(combined)) continue;
    // Skip donation-only pages (but allow if also matches grants/apply/funding)
    if (DONATION_LINK_PATTERNS.test(combined) && !(/grants?|apply|funding|fund\b/i.test(combined))) continue;
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href === '#') continue;

    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch { continue; }

    // Same-domain only
    let absoluteUrl: URL;
    try {
      absoluteUrl = new URL(absolute);
      if (absoluteUrl.hostname !== baseHost) continue;
    } catch { continue; }

    if (JUNK_PATH_PATTERNS.test(absoluteUrl.pathname)) continue;
    // Skip the base URL itself (no self-loop)
    if (absolute === baseUrl || absoluteUrl.pathname === new URL(baseUrl).pathname) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);

    candidates.push({ url: absolute, text, inNav: false });
  }

  return candidates;
}

/**
 * Convenience: fetch a page and parse its detail/application links.
 */
export async function findDetailLinksFromUrl(pageUrl: string): Promise<NavLink[]> {
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
    return parseDetailLinksFromHtml(html, pageUrl);
  } catch {
    return [];
  }
}

/**
 * Convenience: find the single best grant page URL from a homepage.
 *
 * Two-level crawl:
 *   1. Parse homepage for grant-keyword links (existing behaviour)
 *   2. If none found: identify parent menu links, fetch them, parse for grant-keyword links
 *
 * Returns { url, source } or null.
 */
export async function findBestGrantPage(
  homepageUrl: string,
): Promise<{ url: string; source: 'nav-discovery' | 'nav-discovery-deep' } | null> {
  // Level 1: direct grant links on homepage
  const links = await findGrantLinksFromHtml(homepageUrl);
  if (links.length > 0) {
    return { url: links[0].url, source: 'nav-discovery' };
  }

  // Level 2: look for parent nav links, then crawl those for grant links
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(homepageUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const html = await res.text();
    const linkRegex = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    const parentLinks: string[] = [];
    const baseHost = new URL(homepageUrl).hostname;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      const text = match[2].replace(/<[^>]+>/g, '').trim();
      if (!PARENT_NAV_PATTERNS.test(text) && !PARENT_NAV_PATTERNS.test(href)) continue;

      try {
        const absolute = new URL(href, homepageUrl);
        // Same-domain only
        if (absolute.hostname !== baseHost) continue;
        if (!parentLinks.includes(absolute.href)) {
          parentLinks.push(absolute.href);
        }
      } catch { continue; }
    }

    // Fetch up to 5 parent pages and look for grant links
    for (const parentUrl of parentLinks.slice(0, 5)) {
      const deepLinks = await findGrantLinksFromHtml(parentUrl);
      if (deepLinks.length > 0) {
        return { url: deepLinks[0].url, source: 'nav-discovery-deep' };
      }
    }
  } catch {
    // Fall through to null
  }

  return null;
}
