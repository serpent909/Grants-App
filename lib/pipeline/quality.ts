/**
 * Shared data quality utilities for pipeline scripts.
 * Handles quality scoring, deduplication, validation, and sanitization.
 */

// ─── Valid Enumerations ─────────────────────────────────────────────────────

export const VALID_SECTORS = new Set([
  'health', 'mental-health', 'education', 'youth', 'children-families', 'elderly',
  'disability', 'arts-culture', 'sport', 'environment', 'housing', 'community',
  'social-services', 'indigenous', 'rural', 'economic-development', 'animal-welfare',
]);

export const VALID_REGIONS = new Set([
  'northland', 'auckland', 'waikato', 'bay-of-plenty', 'gisborne', 'hawkes-bay',
  'taranaki', 'manawatu-whanganui', 'wellington', 'tasman', 'nelson', 'marlborough',
  'west-coast', 'canterbury', 'otago', 'southland', 'chatham-islands',
]);

export const VALID_GRANT_TYPES = new Set([
  'Government', 'Foundation', 'Corporate', 'Community', 'International', 'Other',
]);

export const VALID_ROUND_FREQUENCIES = new Set([
  'annual', 'quarterly', 'biannual', 'rolling', 'irregular',
]);

// ─── Sanitization ───────────────────────────────────────────────────────────

export function sanitiseSectors(raw: string[]): string[] {
  return (raw || []).filter(s => VALID_SECTORS.has(s));
}

export function sanitiseRegions(raw: string[] | null): string[] | null {
  if (!raw) return null;
  const filtered = raw.filter(r => VALID_REGIONS.has(r));
  return filtered.length > 0 ? filtered : null;
}

export function sanitiseGrantType(raw: string): string {
  return VALID_GRANT_TYPES.has(raw) ? raw : 'Other';
}

export function sanitiseRoundFrequency(raw: string | null): string | null {
  if (!raw) return null;
  return VALID_ROUND_FREQUENCIES.has(raw) ? raw : null;
}

// ─── Quality Score ──────────────────────────────────────────────────────────

export interface QualityScoreInput {
  description: string | null;
  eligibility: string[] | null;
  amount_max: number | null;
  deadline: string | null;
  application_form_url: string | null;
  sectors: string[] | null;
  regions: string[] | null;
  key_contacts: string | null;
}

/**
 * Compute a 0-100 quality score based on field completeness.
 *
 * Scoring:
 *   description (>50 chars):    +20
 *   eligibility (>=2 items):    +15
 *   amount_max present:         +15
 *   deadline present:           +15
 *   application_form_url:       +10
 *   sectors (>=1):              +10
 *   regions (present or null=national): +10
 *   key_contacts:               +5
 */
export function computeQualityScore(grant: QualityScoreInput): number {
  let score = 0;
  if (grant.description && grant.description.length > 50) score += 20;
  if (grant.eligibility && grant.eligibility.length >= 2) score += 15;
  if (grant.amount_max != null) score += 15;
  if (grant.deadline) score += 15;
  if (grant.application_form_url) score += 10;
  if (grant.sectors && grant.sectors.length >= 1) score += 10;
  // null regions means national — that's valid data, so score it
  if (grant.regions === null || (grant.regions && grant.regions.length >= 1)) score += 10;
  if (grant.key_contacts) score += 5;
  return score;
}

// ─── String Similarity (Dice coefficient on bigrams) ────────────────────────

function bigrams(s: string): Set<string> {
  const bg = new Set<string>();
  const lower = s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  for (let i = 0; i < lower.length - 1; i++) {
    bg.add(lower.slice(i, i + 2));
  }
  return bg;
}

export function similarity(a: string, b: string): number {
  const bgA = bigrams(a);
  const bgB = bigrams(b);
  if (bgA.size === 0 && bgB.size === 0) return 1;
  if (bgA.size === 0 || bgB.size === 0) return 0;
  let intersection = 0;
  for (const bg of bgA) {
    if (bgB.has(bg)) intersection++;
  }
  return (2 * intersection) / (bgA.size + bgB.size);
}

// ─── Grant Name Validation ──────────────────────────────────────────────────

/**
 * Check that a grant name extracted by GPT actually appears in the page content.
 * Prevents hallucinated generic names like "General Grant" from entering the DB.
 */
export function grantNameFoundInContent(grantName: string, content: string): boolean {
  const name = grantName.toLowerCase().trim();
  const lc = content.toLowerCase();

  if (lc.includes(name)) return true;

  // Try plural/singular and programme/program variants
  const variants = [
    name.replace(/s\s*$/, ''),
    name.replace(/([^s])\s*$/, '$1s'),
    name.replace(/programme/g, 'program'),
    name.replace(/program(?!me)/g, 'programme'),
  ];
  if (variants.some(v => lc.includes(v))) return true;

  // Check that the distinctive words (not generic grant terms) appear in content
  const GENERIC = new Set([
    'grant', 'grants', 'fund', 'funding', 'programme', 'program',
    'scheme', 'the', 'a', 'an', 'for', 'and', 'of', 'in', 'to',
  ]);
  const distinctive = name.split(/\s+/).filter(w => !GENERIC.has(w) && w.length > 2);
  if (distinctive.length === 0) return true; // Generic names are acceptable — common for NZ trusts with unnamed programs
  return distinctive.every(w => lc.includes(w));
}

// ─── URL Validation ─────────────────────────────────────────────────────────

/** Check that a form URL is on the same domain (or subdomain) as the source page. */
export function isTrustedFormUrl(formUrl: string, pageUrl: string): boolean {
  try {
    const formHost = new URL(formUrl).hostname.replace(/^www\./, '');
    const pageHost = new URL(pageUrl).hostname.replace(/^www\./, '');
    return formHost === pageHost
      || formHost.endsWith('.' + pageHost)
      || pageHost.endsWith('.' + formHost);
  } catch {
    return false;
  }
}

/** Known application form portal domains that are trusted even if off-domain. */
const TRUSTED_PORTAL_DOMAINS = new Set([
  'smartygrants.com.au',
  'fluxx.io',
  'surveymonkey.com',
  'google.com', // Google Forms
  'typeform.com',
  'jotform.com',
  'microsoft.com', // MS Forms
]);

export function isTrustedPortalUrl(formUrl: string): boolean {
  try {
    const host = new URL(formUrl).hostname.replace(/^www\./, '');
    return [...TRUSTED_PORTAL_DOMAINS].some(d => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

// ─── Completeness Score (for dedup — which record to keep) ──────────────────

export interface GrantForDedup {
  id: string;
  funder_id: number;
  funder_name: string;
  name: string;
  type: string | null;
  description: string | null;
  url: string;
  regions: string[] | null;
  sectors: string[] | null;
  eligibility: string[] | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  application_form_url: string | null;
  source_url: string | null;
  data_quality_score: number | null;
}

/** Completeness score for dedup — which record has the most useful data. */
export function completeness(g: GrantForDedup): number {
  // If we have a pipeline v2 quality score, use it
  if (g.data_quality_score != null) return g.data_quality_score;

  let score = 0;
  if (g.description) score += 3;
  if (g.sectors?.length) score += 2;
  if (g.regions?.length) score += 3;
  if (g.eligibility?.length) score += 2;
  if (g.amount_min != null) score += 1;
  if (g.amount_max != null) score += 1;
  if (g.deadline) score += 1;
  if (g.application_form_url) score += 1;
  if (g.source_url) score += 1;
  if (g.description && g.description.length > 100) score += 1;
  return score;
}

// ─── Individual-Only Grant Detection ────────────────────────────────────────

const INDIVIDUAL_NAME_PATTERNS = /\b(scholarship|bursary|bursaries|fellowship|award for individual|personal grant|student grant)\b/i;

const INDIVIDUAL_ELIGIBILITY_PATTERNS = /\b(must be a student|must be an individual|for individuals|personal development|individual applicants)\b/i;

export function isIndividualOnlyGrant(
  name: string,
  eligibility: string[] | null,
  description: string | null,
): boolean {
  if (INDIVIDUAL_NAME_PATTERNS.test(name)) return true;
  if (eligibility?.some(e => INDIVIDUAL_ELIGIBILITY_PATTERNS.test(e))) return true;
  if (description && INDIVIDUAL_ELIGIBILITY_PATTERNS.test(description)) return true;
  return false;
}

// ─── Field Confidence Builder ───────────────────────────────────────────────

export type ConfidenceLevel = 'verified' | 'extracted' | 'inferred' | 'default';

export function buildFieldConfidence(
  fields: Record<string, { value: unknown; confidence: ConfidenceLevel }>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, { value, confidence }] of Object.entries(fields)) {
    if (value != null && value !== '' && !(Array.isArray(value) && value.length === 0)) {
      result[key] = confidence;
    }
  }
  return result;
}
