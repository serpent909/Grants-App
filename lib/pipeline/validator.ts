/**
 * Website and page validation utilities for pipeline V3.
 *
 * Validates that a website actually belongs to a charity by checking:
 * 1. Charity registration number (CC#####) appears on the page
 * 2. Charity name matches via Dice coefficient similarity
 * 3. Domain plausibility (.nz preference)
 */

import { similarity } from './quality';

// ─── Website Validation ────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  confidence: 'high' | 'medium' | 'low';
  method: string;
  details?: string;
}

/**
 * Validate that a webpage belongs to a specific charity.
 *
 * Guards against false positives (e.g., a law firm site that mentions the
 * charity by name). Body-only name matches require a corroborating signal
 * (title similarity or domain keyword overlap) to confirm ownership.
 */
export function validateWebsite(
  charityName: string,
  registrationNumber: string | null,
  pageContent: string,
  pageUrl?: string,
): ValidationResult {
  const lc = pageContent.toLowerCase();

  // Check 1: Registration number on page (strongest signal — near-unique identifier)
  if (registrationNumber) {
    const regNum = registrationNumber.replace(/^CC/i, '').trim();
    if (regNum && (lc.includes(`cc${regNum}`) || lc.includes(regNum))) {
      return { valid: true, confidence: 'high', method: 'registration-number' };
    }
  }

  // Extract title and H1 for ownership signals
  const titleMatch = pageContent.match(/<title[^>]*>(.*?)<\/title>/i);
  const titleText = titleMatch?.[1] || '';
  const h1Match = pageContent.match(/<h1[^>]*>(.*?)<\/h1>/i);
  const h1Text = stripHtml(h1Match?.[1] || '');
  const nameLower = charityName.toLowerCase().trim();
  const titleLower = titleText.toLowerCase();
  const h1Lower = h1Text.toLowerCase();

  // Check 2: Name in page title or H1 — strong ownership signal
  // (A third-party site won't have the charity name as its title/H1)
  if (titleLower.includes(nameLower) || h1Lower.includes(nameLower)) {
    return { valid: true, confidence: 'high', method: 'title-name-match' };
  }

  // Check 3: Title similarity ≥ 0.6
  const titleSim = similarity(charityName, titleText);
  if (titleSim >= 0.6) {
    return { valid: true, confidence: 'high', method: 'title-similarity', details: `dice=${titleSim.toFixed(2)}` };
  }

  // H1 similarity ≥ 0.6
  const h1Sim = h1Text ? similarity(charityName, h1Text) : 0;
  if (h1Sim >= 0.6) {
    return { valid: true, confidence: 'high', method: 'h1-similarity', details: `dice=${h1Sim.toFixed(2)}` };
  }

  // Check 4: Name found in body content — requires corroboration
  // Without this guard, a law firm page mentioning "Bay Trust" as a client
  // would falsely validate as Bay Trust's own website.
  if (lc.includes(nameLower)) {
    // Corroboration A: domain contains distinctive words from the charity name
    if (pageUrl) {
      const domain = bareHostname(pageUrl);
      const coreWords = extractCoreWords(charityName);
      const domainHasName = coreWords.some(w => domain.includes(w));
      if (domainHasName) {
        return { valid: true, confidence: 'high', method: 'body-match-domain-corroborate', details: `domain=${domain}` };
      }
    }

    // Corroboration B: weak title similarity (title is at least somewhat related)
    if (titleSim >= 0.3 || h1Sim >= 0.3) {
      return { valid: true, confidence: 'medium', method: 'body-match-title-corroborate', details: `titleDice=${titleSim.toFixed(2)}` };
    }

    // Body-only match with no corroboration — likely a third-party site
    return { valid: false, confidence: 'low', method: 'body-only-no-corroborate' };
  }

  // Check 5: Core words match in title + body — also requires corroboration
  const textChunk = stripHtml(pageContent).slice(0, 3000);
  const combinedText = `${titleText} ${textChunk}`;
  const coreWords = extractCoreWords(charityName);
  if (coreWords.length >= 2) {
    const allFound = coreWords.every(w => combinedText.toLowerCase().includes(w.toLowerCase()));
    if (allFound) {
      // Only validate if at least one core word is in the title/H1
      const inTitle = coreWords.some(w => titleLower.includes(w) || h1Lower.includes(w));
      if (inTitle) {
        return { valid: true, confidence: 'medium', method: 'core-words-match', details: `words=${coreWords.join(',')}` };
      }
    }
  }

  return { valid: false, confidence: 'low', method: 'no-match' };
}

// ─── Grant-Giving Page Detection ───────────────────────────────────────────

const GRANT_GIVING_KEYWORDS = [
  'apply for funding', 'apply for a grant', 'grant application',
  'funding application', 'we fund', 'we offer grants', 'we provide funding',
  'grants available', 'funding available', 'open for applications',
  'eligibility criteria', 'who can apply', 'how to apply',
  'funding rounds', 'grant programme', 'grant program',
  'community funding', 'community grants', 'funding opportunities',
  'application form', 'apply now', 'apply online',
  'closing date', 'application deadline', 'funding deadline',
  'grants open', 'currently accepting applications',
  'distribution committee', 'distributions to',
  'community investment', 'we distribute', 'we support community',
  'funding criteria', 'grant criteria',
];

const GRANT_RECEIVING_KEYWORDS = [
  'donate now', 'make a donation', 'support us', 'give now',
  'fundraising', 'make a gift', 'your donation', 'contribute',
  'sponsor a child', 'monthly giving', 'regular giving',
  'tax receipt', 'tax deductible donation',
];

/**
 * Determine if page content indicates a grant-giving organisation.
 * Returns a score: positive = grant-giving, negative = grant-receiving.
 */
export function classifyPageContent(content: string): {
  isGrantGiving: boolean;
  isGrantReceiving: boolean;
  givingScore: number;
  receivingScore: number;
} {
  const lc = content.toLowerCase();

  let givingScore = 0;
  for (const kw of GRANT_GIVING_KEYWORDS) {
    if (lc.includes(kw)) givingScore++;
  }

  let receivingScore = 0;
  for (const kw of GRANT_RECEIVING_KEYWORDS) {
    if (lc.includes(kw)) receivingScore++;
  }

  return {
    isGrantGiving: givingScore >= 2 && givingScore > receivingScore,
    isGrantReceiving: receivingScore >= 2 && receivingScore > givingScore,
    givingScore,
    receivingScore,
  };
}

// ─── Domain Validation ─────────────────────────────────────────────────────

/** Domains that are NOT charity websites (directories, professional services, etc.) */
const NON_CHARITY_DOMAINS = new Set([
  // Social media & general
  'google.com', 'facebook.com', 'linkedin.com', 'wikipedia.org',
  'twitter.com', 'instagram.com', 'youtube.com', 'reddit.com',
  'sites.google.com',
  // NZ government (specific blocked sites only — NOT a blanket govt.nz block)
  'charities.govt.nz', 'dia.govt.nz', 'natlib.govt.nz',
  'beehive.govt.nz', 'nzbn.govt.nz', 'education.govt.nz',
  // Grant directories (not charity sites themselves)
  'fundinginformation.org.nz',
  'generosity.org.nz', 'philanthropy.org.nz',
  // News
  'nzherald.co.nz', 'stuff.co.nz', 'rnz.co.nz', 'scoop.co.nz',
  'newshub.co.nz', 'tvnz.co.nz',
  // Crowdfunding
  'givealittle.co.nz', 'gofundme.com',
  // Trustee / fiduciary services (not charity's own site)
  'publictrust.co.nz', 'perpetualguardian.co.nz', 'pgtrust.co.nz',
  'nzgt.co.nz', 'trustees.co.nz',
  // Business/charity data directories — NOT the charity's own website
  'charitydata.co.nz', 'bizdb.co.nz', 'nzxplorer.co.nz',
  'companyhub.nz', 'businesscheck.co.nz', 'nzwao.com',
  'gogravy.co.nz', 'whitepages.co.nz', 'yellowpages.co.nz',
  'opencorporates.com', 'nzbn.govt.nz',
  // International grant/foundation directories
  'grantstation.com', 'fconline.foundationcenter.org',
  'foundationcenter.org', 'candid.org',
]);

/**
 * Grant-management SaaS portal hosts. These are NEVER a funder's canonical
 * homepage — they only host application forms / apply portals. A funder may
 * legitimately link to one as `application_form_url`, but the funder's own
 * `website_url` should never be on one of these hosts.
 *
 * Matched as either the exact domain or any subdomain (e.g. `ccc.smartygrants.com.au`).
 */
const PORTAL_HOSTS = new Set([
  'smartygrants.com.au',
  'smartygrants.com',
  'fluxx.io',
  'grants.comssystems.cloud',
  'comssystems.cloud',
  'grantstation.com',
  'grantforward.com',      // aggregator directory, not a funder site
  'acumenonline.co.nz',    // grant-management SaaS
  'jotform.com',
  'surveymonkey.com',
  'typeform.com',
]);

/**
 * True if the URL's host is a grant-management portal. Rejects these as
 * candidate `website_url` values — they're only valid as apply links.
 */
export function isPortalHost(url: string | null): boolean {
  if (!url) return false;
  const host = bareHostname(url);
  if (!host) return false;
  if (PORTAL_HOSTS.has(host)) return true;
  for (const p of Array.from(PORTAL_HOSTS)) {
    if (host.endsWith(`.${p}`)) return true;
  }
  return false;
}

/** Generic email providers — not charity domains */
export const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.nz', 'yahoo.co.uk',
  'hotmail.com', 'hotmail.co.nz', 'outlook.com', 'outlook.co.nz',
  'live.com', 'live.co.nz', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me', 'mail.com', 'zoho.com',
  'ymail.com', 'inbox.com', 'fastmail.com',
  'xtra.co.nz', 'slingshot.co.nz', 'vodafone.co.nz', 'spark.co.nz',
  'orcon.net.nz', 'kinect.co.nz', 'clear.net.nz', 'paradise.net.nz',
  'wave.co.nz', 'actrix.co.nz', 'callplus.net.nz', 'ihug.co.nz',
  'snap.net.nz', 'inspire.net.nz', '2degrees.nz', 'farmside.co.nz',
]);

/** Professional service domains — not the charity's own website */
export const PROFESSIONAL_DOMAINS = new Set([
  // Trustee companies
  'publictrust.co.nz', 'perpetualguardian.co.nz', 'pgtrust.co.nz', 'nzgt.co.nz',
  // Big 4 / mid-tier accounting
  'deloitte.co.nz', 'kpmg.co.nz', 'ey.com', 'pwc.co.nz', 'pwc.com',
  'bdo.co.nz', 'bdo.nz', 'grantthornton.co.nz', 'crowe.nz', 'crowe.co.nz',
  'bakertillysr.nz', 'findex.co.nz', 'borriegroup.co.nz', 'tgh.co.nz',
  // Law firms
  'buddlefindlay.com', 'chapmantripp.com', 'bellgully.com', 'russellmcveagh.com',
  'minterellison.co.nz', 'simpsongrierson.com', 'dentons.com', 'dlapiper.com',
  'wrlawyers.co.nz',
]);

/**
 * Trust managers that host individual grant/trust pages for charities they manage.
 * The domain itself is blocked (not the charity's own site), but specific paths
 * contain legitimate grant information (eligibility, criteria, application details).
 */
const TRUST_MANAGER_GRANT_PATHS: Array<{ domain: string; pathPrefix: string }> = [
  { domain: 'publictrust.co.nz', pathPrefix: '/grants/' },
  { domain: 'perpetualguardian.co.nz', pathPrefix: '/philanthropy/' },
  { domain: 'pgtrust.co.nz', pathPrefix: '/grants/' },
  { domain: 'nzgt.co.nz', pathPrefix: '/grants/' },
];

/**
 * Check if a URL points to an individual grant page on a trust manager's site.
 * e.g., publictrust.co.nz/grants/page-trust/ is the Page Trust's grant page,
 * hosted by Public Trust because the trust has no website of its own.
 */
export function isTrustManagerGrantPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.toLowerCase();
    return TRUST_MANAGER_GRANT_PATHS.some(
      tm => host === tm.domain && path.startsWith(tm.pathPrefix) && path !== tm.pathPrefix
    );
  } catch {
    return false;
  }
}

/**
 * Domains that are grant aggregators / funding directories.
 * If a charity's grant_page_url points here but it's not the charity's own domain,
 * the charity is a grant RECIPIENT, not a grant GIVER — the page is where they apply.
 */
const GRANT_AGGREGATOR_DOMAINS = new Set([
  'communitymatters.govt.nz',   // DIA lottery grants — charities apply here
  'mylotto.co.nz',              // Lottery grants portal
  'e-clubhouse.org',            // Rotary club directory
  'sporty.co.nz',               // Sports club directory with funding info
  'healthpoint.co.nz',          // Health provider directory
  'centreforsocialimpact.org.nz', // Funding research/directory
  'fundinginformation.org.nz',  // Funding directory
  'generosity.org.nz',          // Philanthropy directory
]);

/**
 * Check if a grant page URL points to a grant aggregator/directory site
 * that the charity doesn't own. This means the charity is a grant recipient,
 * not a grant giver.
 */
export function isAggregatorGrantPage(grantPageUrl: string, charityWebsiteUrl: string | null): boolean {
  try {
    const gpHost = new URL(grantPageUrl).hostname.replace(/^www\./, '').toLowerCase();
    // If it's the charity's own domain, it's fine
    if (charityWebsiteUrl) {
      const ownHost = new URL(charityWebsiteUrl).hostname.replace(/^www\./, '').toLowerCase();
      if (gpHost === ownHost) return false;
    }
    return GRANT_AGGREGATOR_DOMAINS.has(gpHost);
  } catch {
    return false;
  }
}

/**
 * Check if a domain is a plausible charity website.
 * Returns false for known non-charity domains.
 */
export function isPlausibleCharityDomain(hostname: string): boolean {
  const bare = hostname.replace(/^www\./, '').toLowerCase();
  if (NON_CHARITY_DOMAINS.has(bare)) return false;
  if (GENERIC_EMAIL_DOMAINS.has(bare)) return false;
  if (PROFESSIONAL_DOMAINS.has(bare)) return false;
  // Grant-management portals are not a funder's canonical homepage.
  if (isPortalHost(`https://${bare}`)) return false;
  // Check if it's a subdomain of a non-charity domain
  for (const d of Array.from(NON_CHARITY_DOMAINS)) {
    if (bare.endsWith(`.${d}`)) return false;
  }
  return true;
}

/**
 * Extract a usable domain from a charity email address.
 * Returns null for generic/professional domains.
 */
export function extractEmailDomain(email: string | null): string | null {
  if (!email) return null;
  const parts = email.trim().split('@');
  if (parts.length !== 2) return null;
  const domain = parts[1].toLowerCase();
  if (GENERIC_EMAIL_DOMAINS.has(domain) || PROFESSIONAL_DOMAINS.has(domain)) return null;
  return domain;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Strip HTML tags from content for text analysis */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract "core" distinctive words from a charity name (drop generic terms) */
const GENERIC_NAME_WORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'in', 'to', 'trust', 'foundation',
  'fund', 'charitable', 'community', 'new', 'zealand', 'nz', 'society',
  'incorporated', 'inc', 'ltd', 'limited', 'board', 'association',
]);

function extractCoreWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !GENERIC_NAME_WORDS.has(w));
}

// ─── Funder Name Validation ────────────────────────────────────────────────

/**
 * Sanity-check a funder name extracted by GPT from page content.
 *
 * GPT occasionally returns sentence fragments, form-field labels, page headings,
 * or descriptions instead of the actual org name. These corrupt `charities.name`
 * and `grants.funder_name` and are visually obvious in the UI.
 *
 * Rejects names that:
 *  - are too short or too long
 *  - contain URLs, emails, list separators, or form metadata
 *  - start with articles/pronouns typical of sentence fragments
 *  - contain multiple sentences or question marks
 *  - contain currency figures (extracted prose often includes amounts)
 *  - contain newlines
 *
 * Legitimate names with initials (e.g. "C. Alma Baker Charitable Trust",
 * "A.J. Day Options Trust", "Dr. W.R. Lawrence Memorial Trust") are preserved
 * by requiring the sentence-break check to see a capital letter AFTER a space-dot,
 * not a single letter followed by a period.
 */
export function isValidFunderName(name: string): boolean {
  if (!name) return false;
  const trimmed = name.trim();

  // Hard length limits
  if (trimmed.length < 2) return false;
  if (trimmed.length > 200) return false;

  // Hard rejects — these NEVER appear in legitimate organisation names
  if (/[\n\r\t]/.test(trimmed)) return false;
  if (/https?:\/\//i.test(trimmed)) return false;
  if (/\$[\d,]+/.test(trimmed)) return false; // dollar amounts
  // Prose fragments — no legitimate org name contains these action phrases
  if (/\b(applications? (open|close)|closing date|apply for|eligib\w+ criteria|how to apply|for the \d{4} round)\b/i.test(trimmed)) return false;
  // Verb-object patterns: "provides funding", "offers grants", "provides contestable funding", etc.
  // Verb must be lowercase (prose pattern) — capitalized verbs in names like "Returned Services" are proper nouns.
  if (/\b(provides?|offers?|delivers?|gives?|distributes?|awards?)\s+(\w+\s+){0,5}(funding|grants?|support|money|scholarships?|contestable)\b/.test(trimmed)) return false;
  // "returned to" — specific to "monies returned to the community" prose pattern
  if (/\breturned\s+to\b/.test(trimmed)) return false;
  // Relative clauses — "that provides", "which offers" — never appear in names
  if (/\b(that|which)\s+(provides?|offers?|funds?|supports?|gives?|distributes?|awards?|delivers?)\b/i.test(trimmed)) return false;
  // Imperative/directive prose starters — "Discover the latest...", "Check out...", "Links to...", "See our..."
  if (/^(Discover|Check|Links?|Browse|Explore|See|View|Find|Learn|Read|Get|Search|Visit)\s+(the|our|to|out|for|more|all|at)\b/i.test(trimmed)) return false;
  // Sentence-ending period + long — legitimate names rarely end in a full stop
  if (trimmed.length > 60 && /[a-z]\.\s*$/.test(trimmed)) return false;

  // Email pattern — require domain.tld form so "Church@Cedarwood" (no TLD) is allowed
  if (/@[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed)) return false;

  // Multiple question marks (single ? allowed for stylized names; multi-sentence prose will have more)
  if ((trimmed.match(/\?/g) || []).length >= 1 && trimmed.length > 60) return false;

  // Very long with prose starter — combined signal for sentence fragments
  if (trimmed.length > 100) {
    // Only the strongest prose starters, followed by lowercase (not initials)
    if (/^(The|A|An|And|This|That|These|Those|We|Our|It|They|Here|There|Please)\s+[a-z]{5,}/.test(trimmed)) return false;
  }

  // > 35 words — extremely long (longest legit NZ register name is ~25 words)
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 35) return false;

  return true;
}

// ─── URL Helpers ───────────────────────────────────────────────────────────

export function bareHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

export function normaliseWebsite(url: string | null): string | null {
  if (!url || !url.trim()) return null;
  let u = url.trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = `https://${u}`;
  try { new URL(u); return u; } catch { return null; }
}

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.protocol = 'https:';
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/$/, '');
    return u.toString();
  } catch { return raw.trim(); }
}
