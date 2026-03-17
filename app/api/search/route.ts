import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { tavilyClient } from '@/lib/tavily';
import { serperSearch } from '@/lib/serper';
import { OrgInfo, GrantOpportunity, SearchResult } from '@/lib/types';
import { getMarket, MarketConfig } from '@/lib/markets';
import { findMatchingCharities, loadSearchResult, saveSearchResult } from '@/lib/db';

const TODAY = new Date().toISOString().split('T')[0];
const CURRENT_YEAR = new Date().getFullYear();

// ─── Pipeline toggles ──────────────────────────────────────────────────────
const SEARCH_MODE: 'full' | 'cached' = 'cached';   // 'cached' = return DB-cached results (free)
const ENABLE_SITE_CRAWL = false;

// ─── Cost tracking ───────────────────────────────────────────────────────────

interface CostTracker {
  gpt4oIn: number;
  gpt4oOut: number;
  gpt4oMiniIn: number;
  gpt4oMiniOut: number;
  tavilyUrls: number;
  serperQueries: number;
}

function createCostTracker(): CostTracker {
  return { gpt4oIn: 0, gpt4oOut: 0, gpt4oMiniIn: 0, gpt4oMiniOut: 0, tavilyUrls: 0, serperQueries: 0 };
}

function trackOpenAI(costs: CostTracker, model: string, usage?: { prompt_tokens?: number; completion_tokens?: number }) {
  if (!usage) return;
  const isMini = model.includes('mini');
  if (isMini) {
    costs.gpt4oMiniIn += usage.prompt_tokens ?? 0;
    costs.gpt4oMiniOut += usage.completion_tokens ?? 0;
  } else {
    costs.gpt4oIn += usage.prompt_tokens ?? 0;
    costs.gpt4oOut += usage.completion_tokens ?? 0;
  }
}

// Pricing per token (USD)
const PRICING = {
  gpt4oIn: 2.50 / 1_000_000,
  gpt4oOut: 10.00 / 1_000_000,
  gpt4oMiniIn: 0.15 / 1_000_000,
  gpt4oMiniOut: 0.60 / 1_000_000,
  tavilyPerUrl: 0.008,
  serperPerQuery: 0.001,
};

function computeCost(costs: CostTracker) {
  const openai4o = costs.gpt4oIn * PRICING.gpt4oIn + costs.gpt4oOut * PRICING.gpt4oOut;
  const openaiMini = costs.gpt4oMiniIn * PRICING.gpt4oMiniIn + costs.gpt4oMiniOut * PRICING.gpt4oMiniOut;
  const tavily = costs.tavilyUrls * PRICING.tavilyPerUrl;
  const serper = costs.serperQueries * PRICING.serperPerQuery;
  return { openai4o, openaiMini, tavily, serper, total: openai4o + openaiMini + tavily + serper };
}

// ─── Prompt factory ───────────────────────────────────────────────────────────

/**
 * Build all three prompts parameterised for the given market.
 * No market-specific strings live outside this function.
 */
function buildPrompts(market: MarketConfig, orgRegions?: string[]) {
  const { country, currency } = market;
  const hintsText = market.funderTypeHints.map(h => `- ${h}`).join('\n');
  const regionText = orgRegions?.length ? orgRegions.join(', ') : '';

  const FUNDER_ENUMERATION_PROMPT = `You are a comprehensive ${country} grant research expert.

Your task: enumerate ALL specific named grant-giving organisations that operate in ${country} and fund non-profit community organisations. This is a knowledge recall task — draw entirely on your training data. The organisation details provided are used only to add 10–15 sector-specific funders at the end that are especially relevant to their mission.

Enumerate funders across ALL of the following categories. Be exhaustive within each:
${hintsText}

Special instruction: for LOCAL COUNCILS / TERRITORIAL AUTHORITIES, list EVERY council individually by its full official name — do not summarise or group them.

For each funder, generate a targeted web search query designed to find their current active grant application page. The query must contain the exact organisation name, a descriptor ("grants", "apply", "community fund"), and the year ${CURRENT_YEAR}.

Return a JSON object:
{
  "funders": [
    { "name": "Pub Charity", "category": "Gaming Trust", "region": "national", "searchQuery": "Pub Charity grants apply ${country} ${CURRENT_YEAR}" },
    { "name": "Auckland Council", "category": "Local Council", "region": "Auckland", "searchQuery": "Auckland Council community grants apply ${CURRENT_YEAR}" }
  ]
}

Aim for 80–150 funders. Prefer more over fewer — it is better to include a funder with no active grants than to miss a genuine one. If a name you generate does not exist, the downstream web search will return no results and no harm is done.`;

  const PROGRAM_ENUMERATION_PROMPT = `You are a ${country} grant research specialist focused on finding specific, named grant PROGRAMS — not just funders — that are directly relevant to a given organisation's mission.

Your task: identify 40–50 specific named grant programs that closely match this organisation's purpose, sector, and activities. Focus on depth and relevance, not breadth.

Think across these dimensions:
- Sub-programs within large funders (e.g. a health funder's "Youth Mental Health Initiative" rather than just listing the funder)
- Sector-specific fund windows within gaming trusts, council funds, and government agencies
- Thematic cross-sector programs that explicitly match this org's activity type (e.g. youth development, digital inclusion, disability, environment)
- Foundation programs that name this org's target population or activity type in their eligibility criteria

For each program, generate a targeted web search query that will find that specific program's application page. Include the program name, funder name if known, relevant keywords, and the year ${CURRENT_YEAR}.

Return a JSON object:
{
  "programs": [
    {
      "name": "Youth Development Fund",
      "funder": "Foundation North",
      "sector": "Youth",
      "searchQuery": "Foundation North Youth Development Fund apply ${CURRENT_YEAR}"
    }
  ]
}

Aim for 40–50 programs. Missing a genuinely relevant program is the only failure mode — overlap with the general funder list is fine, deduplication handles it.`;

  const PAGE_EXTRACTION_PROMPT = `You are an expert ${country} grant researcher. You will be given real web page content scraped from ${country} grant and funding websites.

Your task: Read each page carefully and extract EVERY specific grant PROGRAM described on it.

RULES:
- If the page content is an error page (404, page not found, access denied, server error, or similar) or contains no actual grant information, return [] immediately.
- If the page is a news article, press release, blog post, media announcement, or any page that merely REPORTS on a grant rather than being the funder's own grant program page: look for a direct URL in the content linking to the actual application or funder grants page. If you find one, extract the grant using THAT URL. If you cannot find a direct link to an actual grant page in the content, DO NOT extract the grant — skip it entirely.
- If the page is a "record of grants" or list of past grant recipients (i.e. it shows which organisations received funding in a given year/round, rather than describing a grant program that can be applied for), DO NOT extract individual entries as grants. Instead, if the page identifies the parent grant PROGRAM (e.g. "COGS", "Creative Communities"), extract only that single program with a URL pointing to its application page, not to the recipient list.
- Only extract grants EXPLICITLY described on the page. Never add grants from training memory.
- Extract ALL grants on the page regardless of whether they seem relevant to the org — scoring will assess fit.
  Only skip grants that fall into one of these impossible categories:
  a) Grants exclusively for commercial businesses or government agencies (non-profits cannot apply).
  b) Grants with EXPLICIT geographic restrictions to a specific country, state, province, or region that is NOT ${country} and NOT a global/international program. Examples to skip: a grant restricted to "New York State residents", "UK organisations only", "US-based nonprofits", "Victorian community groups". Examples to KEEP: "open to organisations worldwide", "international nonprofits eligible", "global health funding", or any grant with no geographic restriction stated.
  When in doubt about geographic eligibility, include the grant — the scorer will assess it.
- Do NOT extract a grant ONLY if the page explicitly states it is closed or shows a past closing date. If no closing date is mentioned, or if the status is unclear, extract the grant — many grants run on rolling or annual cycles without stating "open" on the page.
- Use current organisation names.
- URL: If this page is a general directory or listing that references grants from multiple different funders, set each grant's URL to the most specific page for that grant program — look for hyperlinks in the page content pointing to the actual funder or application page. Only use the current page's URL as a grant URL if no more specific link is available. Never set a grant's URL to a directory or listing page if a direct funder URL appears in the content.
- amountMin/amountMax in ${currency} integers if stated, otherwise omit those fields.
- pageContent: copy a verbatim 1500-char excerpt from the page most relevant to this specific grant — prioritise eligibility criteria, funded activities, deadlines, and grant amounts.

Return ONLY a valid JSON array (empty [] if no grants found), no markdown, no code fences:
[
  {
    "name": "Specific Grant Program Name",
    "funder": "Current Organisation Name",
    "type": "Government|Foundation|Corporate|Community|International|Other",
    "description": "2-3 sentences: what this program funds and who is eligible",
    "amountMin": 5000,
    "amountMax": 50000,
    "url": "https://exact-url-for-this-grant",
    "pageContent": "verbatim 1500-char excerpt covering eligibility, purpose, deadline, amounts"
  }
]`;

  const SCORING_SYSTEM_PROMPT = `You are an expert ${country} grant researcher. Score each grant program for a specific organisation.

URL QUALITY CHECK (apply first, before scoring):
Examine the grant's description and pageContent. If the content reads like a news article, press release, or media announcement ABOUT a grant (rather than being the funder's actual grant program page or application information), then: set attainability=0, alignment=0, overall=0, and set attainabilityNotes to "Content appears to be a news article about a grant rather than the funder's actual grant page." Still include it in the output so the UI can filter it by score.
Do NOT zero out a grant merely because the URL contains /news/, /update/, /story/, or /article/ — many funders publish grant information under these paths. Judge by content, not URL patterns.
Also zero out grants whose URL or content is a "record of grants" or past recipients list (showing who received funding) rather than an application page for a grant program.

GEOGRAPHIC ELIGIBILITY CHECK (apply next, before scoring):
Determine whether the organisation in ${country} is eligible to apply. A grant is geographically INELIGIBLE if it explicitly restricts applicants to a specific country, state, province, or region that is NOT ${country} (e.g. "US-based organisations only", "New York State residents", "Victorian community groups", "UK registered charities"). Truly global/international programs (e.g. "open worldwide", "international nonprofits eligible") ARE eligible.
- If INELIGIBLE: set alignment=0, attainability=0, ease=5, overall=0. Set alignmentReason to explain the geographic exclusion clearly (e.g. "This fund is restricted to US-based organisations and is not open to ${country} applicants."). Still include the grant in the output — it will be filtered by score in the UI.
- If ELIGIBLE or UNCLEAR: score normally.

REGIONAL RELEVANCE (apply during scoring):${regionText ? `
The organisation operates in: ${regionText}.` : ''}
- National-level and country-wide funders are ALWAYS relevant regardless of the org's region.
- Regional or local funders (e.g. district council grants, regional community trusts) are relevant ONLY if they serve one of the org's operating regions.${regionText ? `
- If a grant is explicitly restricted to a region NOT in [${regionText}], reduce attainability by 3-4 points and note in attainabilityNotes that the org does not operate in that region.` : ''}
- When in doubt about a funder's geographic scope, assume it is available to the org.

FORM-OF-SUPPORT CHECK (apply during alignment scoring):
The organisation is seeking a specific type of support (usually cash funding of a stated amount). Compare what the organisation needs against what the grant/programme actually provides:
- Cash grants/funding: direct monetary support the org can spend as needed
- In-kind donations: donated goods, equipment, or materials (not cash)
- Services/programmes: training, mentoring, capacity building, volunteer placement
- Fee waivers/discounts: reduced-cost access to products or services
If the grant provides in-kind support (e.g. donated equipment, pro-bono services, discounted software) but the organisation is seeking cash funding, these are MISALIGNED even if the topic area overlaps. Reduce alignment to 3-4 maximum (partial overlap at best). The org cannot use donated goods to pay for contractors, wages, or other cash expenses.
Conversely, if the org specifically seeks in-kind support and the grant provides it, score normally.

Scoring dimensions (0–10):
alignment — how well the grant purpose AND form of support match the org mission AND specific funding request
  0-3 poor match or wrong form of support | 4-6 partial overlap | 7-8 good match | 9-10 designed for exactly this

ease — how easy it is to apply (higher = simpler process)
  1-2 multi-stage/site visits | 3-4 complex/extensive | 5-6 full proposal | 7-8 moderate effort | 9-10 simple online form

attainability — likelihood this org wins given competition and eligibility fit
  1-2 very competitive/national funder | 3-4 competitive | 5-6 moderate | 7-8 regional/less competitive | 9-10 strong match, few applicants

overall = (alignment × 0.5) + (attainability × 0.3) + (ease × 0.2), rounded to 1dp

DEADLINE RULE — today is ${TODAY}:
- Extract a deadline ONLY if the pageContent contains a specific future date explicitly stated as a closing or application date.
- The date must be after ${TODAY}. If the date is in the past, or if no date is stated, omit the deadline field entirely — do not guess.
- Most grants run on rolling or annual cycles. Absence of a deadline means rolling/open, not closed.

CRITICAL: You MUST score every single grant provided. Do not skip, omit, or summarise any.

Return a JSON object with this exact structure:
{
  "orgSummary": "2-3 sentence summary of this organisation and their funding needs (first batch only, empty string for subsequent batches)",
  "grants": [
    {
      "id": "g-1",
      "name": "...", "funder": "...", "type": "...", "description": "...",
      "amountMin": 5000, "amountMax": 50000, "deadline": "2026-09-30", "url": "...",
      "scores": { "alignment": 8, "ease": 6, "attainability": 6, "overall": 7.2 },
      "alignmentReason": "1-2 sentences explaining alignment with this org's specific mission and funding request",
      "applicationNotes": "1-2 sentences on application process complexity and what is required",
      "attainabilityNotes": "1-2 sentences on competition level and why this org is or isn't a strong candidate"
    }
  ]
}`;

  const RELEVANCE_TRIAGE_PROMPT = `You are a grant relevance screener for ${country} non-profits. Classify each grant as RELEVANT or SKIP.

Mark SKIP ONLY when you are ≥90% confident the grant is irrelevant. When in doubt, mark RELEVANT.

SKIP criteria (must meet at least one):
1. The grant is exclusively for a completely different sector with NO overlap to the organisation's sectors. If ANY sector partially overlaps, mark RELEVANT.
2. The grant is restricted to a specific region/locality the organisation does NOT operate in, AND the grant is clearly local (not national or country-wide). National funders are always RELEVANT.
3. The grant is exclusively for an organisation type that clearly does not match (e.g. "schools only", "hospitals only", "sports clubs only").
4. The grant's funding range is dramatically mismatched — e.g. the grant maximum is under ${currency}1,000 and the org seeks ${currency}100,000+, or the grant minimum is ${currency}1,000,000+ and the org seeks ${currency}5,000.
5. The content describes a news article, past recipient list, or non-grant page rather than an actual grant program.

Do NOT mark SKIP for:
- Grants where the sector partially overlaps or is broadly stated
- Grants where eligibility is unclear or not specified
- National or country-wide grants (always RELEVANT regardless of org region)
- Grants where the amount range is unstated or partially overlaps the org's request
- Any grant where you are less than 90% confident it is irrelevant

Return a JSON object:
{
  "decisions": [
    { "index": 0, "decision": "RELEVANT" },
    { "index": 1, "decision": "SKIP", "reason": "Arts-only grant; org is health sector" }
  ]
}

You MUST return a decision for every grant. Default to RELEVANT.`;

  return { FUNDER_ENUMERATION_PROMPT, PROGRAM_ENUMERATION_PROMPT, PAGE_EXTRACTION_PROMPT, SCORING_SYSTEM_PROMPT, RELEVANCE_TRIAGE_PROMPT };
}

// ─── Seed query builder ───────────────────────────────────────────────────────

function buildSeedQueries(market: MarketConfig, fundingPurpose: string): string[] {
  return market.seedQueryTemplates.map(t =>
    t
      .replace('{country}', market.country)
      .replace('{purpose}', fundingPurpose.slice(0, 80))
      .replace('{year}', String(CURRENT_YEAR))
      .replace('{currency}', market.currency)
  );
}

// ─── Domain filter builder ────────────────────────────────────────────────────

// URL path patterns that are categorically never grant application pages.
// Applied before Tavily extraction to avoid wasting credits on non-grant pages.
const NON_GRANT_PATH_PATTERNS = [
  // News / media
  /\/press-release/i,
  /\/media-release/i,
  /\/news-release/i,
  /\/blog\//i,
  // Auth / account
  /\/login\b/i,
  /\/signin\b/i,
  /\/sign-in\b/i,
  /\/register\b/i,
  /\/signup\b/i,
  /\/sign-up\b/i,
  /\/forgot-password/i,
  /\/my-account/i,
  // Legal / policy
  /\/privacy-policy/i,
  /\/privacy-statement/i,
  /\/terms-of-use/i,
  /\/terms-and-conditions/i,
  /\/terms-of-service/i,
  /\/cookie-policy/i,
  /\/disclaimer\b/i,
  // Careers / HR
  /\/careers\b/i,
  /\/jobs\b/i,
  /\/vacancies\b/i,
  /\/work-with-us/i,
  // Technical / infrastructure
  /\/sitemap/i,
  /\/feed\/?$/i,
  /\/rss\b/i,
  /\/wp-json\//i,
  // Reports / financials (past, not current grants)
  /\/annual-reports?\b/i,
  /\/financial-statements/i,
  // Commerce / donations (receiving money, not giving grants)
  /\/shop\//i,
  /\/cart\b/i,
  /\/checkout\b/i,
  /\/donate\b/i,
  /\/donation\b/i,
];

function buildIsGrantPage(market: MarketConfig): (url: string) => boolean {
  return (url: string) => {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      if (market.excludedDomains.some(d => host.endsWith(d) || host === d)) return false;
      if (NON_GRANT_PATH_PATTERNS.some(p => p.test(path))) return false;
      return true;
    } catch { return true; }
  };
}

// ─── Rate-limit helpers ───────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      const headers = (err as { headers?: Headers })?.headers;
      if (status === 429 && attempt < maxRetries) {
        const retryMs = headers
          ? parseInt(headers.get('retry-after-ms') || headers.get('retry-after') || '2000', 10) * (headers.get('retry-after-ms') ? 1 : 1000)
          : 2000 * Math.pow(2, attempt);
        const waitMs = Math.min(retryMs + 200, 30_000);
        console.warn(`[GrantSearch] Rate limited — waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(r => setTimeout(r, waitMs));
        attempt++;
      } else {
        throw err;
      }
    }
  }
}

async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtractedPage {
  url: string;
  content: string;
}

type DiscoveryStep = 'curated' | 'directory' | 'enum' | 'seed' | 'regional' | 'directory-deepdive' | 'purpose' | 'associative' | 'broad' | 'gap-fill' | 'site-crawl' | 'db-enrichment' | 'unknown';

interface SearchHit {
  url: string;
  snippet: string;
  origin?: DiscoveryStep;
}

interface DiscoveredGrant {
  name: string;
  funder: string;
  type: GrantOpportunity['type'];
  description: string;
  amountMin?: number;
  amountMax?: number;
  url: string;
  pageContent?: string;
}

interface EnumeratedFunder {
  name: string;
  category: string;
  region: string;
  searchQuery: string;
}

interface EnumeratedProgram {
  name: string;
  funder: string;
  sector: string;
  searchQuery: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deduplicateByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(r => {
    const key = normaliseUrl(r.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateGrants(grants: DiscoveredGrant[]): DiscoveredGrant[] {
  const seenByName = new Set<string>();
  return grants.filter(g => {
    const nameKey = `${g.funder.toLowerCase().trim()}||${g.name.toLowerCase().trim()}`;
    if (seenByName.has(nameKey)) return false;
    seenByName.add(nameKey);
    return true;
  });
}

function stripFences(text: string): string {
  return text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
}

function normaliseUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const path = (u.pathname.replace(/\/+$/, '') || '/').toLowerCase();
    return `${host}${path}`;
  } catch {
    return url.toLowerCase().split('?')[0].split('#')[0];
  }
}

/**
 * Extract full page content via Tavily.
 * snippetFallback: map of normalised URL → search snippet used when Tavily extract fails.
 * Many corporate/government sites block scrapers — snippets ensure we still get content.
 */
async function extractPages(
  urls: string[],
  snippetFallback?: Map<string, string>,
  costs?: CostTracker,
): Promise<ExtractedPage[]> {
  if (!urls.length) return [];
  if (costs) costs.tavilyUrls += urls.length;
  const BATCH = 20;
  const EXTRACT_CONCURRENCY = 8;

  const batches: string[][] = [];
  for (let i = 0; i < urls.length; i += BATCH) {
    batches.push(urls.slice(i, i + BATCH));
  }

  const batchResults = await withConcurrency(
    batches.map((batch, batchIdx) => async (): Promise<ExtractedPage[]> => {
      const batchPages: ExtractedPage[] = [];
      const extracted = new Set<string>();

      try {
        const result = await tavilyClient.extract(batch);
        result?.results?.forEach((r) => {
          if (r?.rawContent && r?.url) {
            batchPages.push({ url: r.url, content: r.rawContent.slice(0, 8000) });
            extracted.add(normaliseUrl(r.url));
          }
        });
      } catch (err) {
        console.warn(`[GrantSearch] Extract batch ${batchIdx + 1} failed:`, err);
      }

      // Fallback: use search snippet for any URL that failed full extraction
      if (snippetFallback) {
        batch.forEach(url => {
          const key = normaliseUrl(url);
          if (!extracted.has(key)) {
            const snippet = snippetFallback.get(key);
            if (snippet && snippet.length > 150) {
              batchPages.push({ url, content: snippet });
              console.log(`[GrantSearch] Snippet fallback: ${url}`);
            }
          }
        });
      }

      return batchPages;
    }),
    EXTRACT_CONCURRENCY,
  );

  return batchResults.flat();
}

// ─── Step 0: Dynamic funder discovery ────────────────────────────────────────

/**
 * Dynamically discover funder URLs for a market by:
 *   0a: Extracting grant directory pages and harvesting links from their content
 *   0b: Running site: searches against each directory domain
 *
 * For all markets this is the primary dynamic funder discovery mechanism.
 */
async function discoverFunderUrls(
  market: MarketConfig,
  sectorLabels: string[],
  regionNames: string[],
  fundingPurpose: string,
  costs?: CostTracker,
): Promise<string[]> {
  const discovered: string[] = [];

  // 0a: Extract directory pages and harvest embedded funder links
  const directoryPages = await extractPages(market.grantDirectories, undefined, costs);
  for (const page of directoryPages) {
    const urlMatches = page.content.match(/https?:\/\/[^\s"')>\]]+/g) || [];
    const directoryHosts = market.grantDirectories.map(d => {
      try { return new URL(d).hostname; } catch { return ''; }
    });
    urlMatches
      .filter(u => {
        try {
          const host = new URL(u).hostname.toLowerCase();
          // Keep external links not on the directory domain itself and not excluded
          return !directoryHosts.some(dh => host === dh || host.endsWith(`.${dh}`))
            && !market.excludedDomains.some(ex => host.endsWith(ex) || host === ex);
        } catch { return false; }
      })
      .forEach(u => discovered.push(u));
  }

  // 0b: Exhaustive site: searches against each directory domain
  // Grant directories (e.g. fundinginformation.org.nz) list thousands of grants —
  // we mine them deeply with every sector × region × purpose combination.
  const siteTasks: (() => Promise<void>)[] = [];
  for (const dir of market.grantDirectories) {
    let domain: string;
    try { domain = new URL(dir).hostname; } catch { continue; }

    // Base queries
    const queries: string[] = [
      `site:${domain} grants apply`,
      `site:${domain} grants ${CURRENT_YEAR}`,
      `site:${domain} community fund apply nonprofits`,
      `site:${domain} charitable trust grants`,
      `site:${domain} funding opportunities open`,
      `site:${domain} ${fundingPurpose.slice(0, 60)}`,
    ];

    // Every sector
    for (const sector of sectorLabels) {
      queries.push(`site:${domain} ${sector} grants`);
      queries.push(`site:${domain} ${sector} funding apply`);
    }

    // Every region
    for (const region of regionNames) {
      queries.push(`site:${domain} ${region} grants`);
      queries.push(`site:${domain} ${region} community fund`);
    }

    // Sector × region combinations (most targeted — finds niche directory pages)
    for (const sector of sectorLabels.slice(0, 6)) {
      for (const region of regionNames.slice(0, 4)) {
        queries.push(`site:${domain} ${region} ${sector} grants`);
      }
    }

    // Deduplicate queries before executing
    const uniqueQueries = [...new Set(queries)];
    for (const q of uniqueQueries) {
      siteTasks.push(async () => {
        try {
          if (costs) costs.serperQueries++;
          const r = await serperSearch(q, { num: 10, gl: market.id });
          r.results.forEach(hit => discovered.push(hit.url));
        } catch { /* ignore individual failures */ }
      });
    }
  }
  await withConcurrency(siteTasks, 20);

  console.log(`[GrantSearch] Step 0: ${discovered.length} URLs discovered from directories`);
  return [...new Set(discovered)];
}

// ─── Purpose-driven seed query generation ────────────────────────────────────

/**
 * Uses GPT to generate 10 highly-targeted search queries based on the org's
 * specific funding purpose and website content — finds niche programs that
 * the general funder enumeration may miss.
 */
async function generatePurposeSeeds(
  market: MarketConfig,
  fundingPurpose: string,
  orgContent: string,
  costs?: CostTracker,
): Promise<string[]> {
  try {
    const res = await withRetry(() => openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a grant search specialist for ${market.country}. Generate highly targeted web search queries to find grant APPLICATIONS pages for a specific organisation.

Your queries should:
- Be specific enough to find grant application pages, not news articles or general information
- Use terminology that grant administrators actually use
- Include geographic qualifiers (region, country, or "national")
- Vary in approach: by sector, by activity type, by population served, by funding mechanism
- Include the year ${CURRENT_YEAR} where relevant

Return a JSON object:
{ "queries": ["query 1", "query 2", ...] }

Generate exactly 10 queries. Each must be meaningfully different — no paraphrases of the same search.`,
        },
        {
          role: 'user',
          content: `Country: ${market.country}
Funding purpose: ${fundingPurpose}
Organisation website summary: ${orgContent.slice(0, 800)}

Generate 10 specific grant search queries for this organisation.`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 800,
    }));
    if (costs) trackOpenAI(costs, 'gpt-4o-mini', res.usage);
    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
    const queries: string[] = Array.isArray(parsed.queries) ? parsed.queries : [];
    console.log(`[GrantSearch] Purpose seeds: ${queries.length} queries generated`);
    return queries;
  } catch {
    console.warn('[GrantSearch] Purpose seed generation failed');
    return [];
  }
}

// ─── Regional search generation ──────────────────────────────────────────────

/**
 * Generates targeted search queries for local/regional funders in the org's
 * operating regions. Uses explicit region names from the form + any additional
 * geographic signals in the funding purpose. Runs in parallel with Step 0+1.
 */
async function generateRegionalSearches(
  market: MarketConfig,
  fundingPurpose: string,
  regionNames: string[],
  sectors: string[],
  costs?: CostTracker,
): Promise<string[]> {
  try {
    const res = await withRetry(() => openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a grant search specialist for ${market.country}. Generate targeted search queries to find local and regional grant-giving organisations in the user's operating regions.

The user operates in these regions: ${regionNames.join(', ') || 'nationwide'}.
Their sectors: ${sectors.join(', ') || 'general community'}.

For EACH operating region, generate a broad mix of queries covering:
1. Community and regional trusts: "[Region] community trust grants apply", "[Region] community foundation grants"
2. District and city councils: "[City/district] council community grants fund apply"
3. Small/local charitable trusts: "[Region] charitable trust grants nonprofits apply", "[Town] charitable trust community fund"
4. Private and family foundations: "[Region] family foundation grants", "[Region] private foundation community grants nonprofits"
5. Corporate trusts and law firm trusts: "[Region] corporate charitable trust apply grants"
6. Sector-specific local grants: "[Region] [sector] fund grants apply nonprofit"
7. Sub-regional areas: major cities, towns, and districts within each region that may have their own funders

The goal is to surface SMALL and OBSCURE local funders — trusts associated with businesses, family foundations, and community endowments — that would not appear in a national funder list. These are the hardest to find and the most worth targeting with specific queries.

Return a JSON object:
{ "queries": ["query 1", "query 2", ...] }

Generate 20–30 queries. Prioritise breadth of funder type over repeating the same pattern.`,
        },
        {
          role: 'user',
          content: `Country: ${market.country}\nOperating regions: ${regionNames.join(', ')}\nSectors: ${sectors.join(', ')}\nFunding purpose: ${fundingPurpose}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1400,
    }));
    if (costs) trackOpenAI(costs, 'gpt-4o-mini', res.usage);
    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
    const queries: string[] = Array.isArray(parsed.queries) ? parsed.queries : [];
    console.log(`[GrantSearch] Regional searches: ${queries.length} queries generated`);
    return queries;
  } catch {
    console.warn('[GrantSearch] Regional search generation failed');
    return [];
  }
}

// ─── Associative funder discovery ────────────────────────────────────────────

/**
 * After Step 1 enumeration, performs a gap analysis: identifies funders that
 * SHOULD be in the list but are missing — especially regional peers, recently
 * rebranded orgs, and small/local trusts. Runs between Step 1 and Step 2.
 */
async function generateAssociativeQueries(
  market: MarketConfig,
  fundingPurpose: string,
  enumeratedFunders: EnumeratedFunder[],
  regionNames: string[],
  previousFunders: string,
  costs?: CostTracker,
): Promise<string[]> {
  try {
    const funderSample = enumeratedFunders.slice(0, 60).map(f => `${f.name} (${f.region})`).join(', ');
    const res = await withRetry(() => openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a ${market.country} grant research expert performing a COVERAGE GAP ANALYSIS.

The organisation operates in: ${regionNames.join(', ') || 'nationwide'}.${previousFunders ? `\nThey have previously been funded by: ${previousFunders}. Use these as strong signals — find SIMILAR funders in the same categories, regions, and sectors.` : ''}

You have been given a list of funders already identified by a previous step. Your task is to find MISSING funders — especially:

1. **Regional peers**: If a community trust in one region is listed but the equivalent trust in the organisation's operating region (${regionNames.join(', ') || 'nationwide'}) is NOT listed, generate a query to find it.
2. **Peers of previous funders**: If the org has been funded before, find other funders of the same TYPE and in the same REGION as those previous funders.
3. **Sector-specific trusts**: Charitable trusts dedicated to the org's specific sector (health, maternity, education, environment, sport, youth, etc.) that are missing from the list.
4. **Small/local trusts**: Family foundations, community charitable trusts, and local endowments in the org's geographic area that are too small or niche for a general enumeration to catch.
5. **Recently rebranded organisations**: Trusts or foundations that may have changed their name in the last 2 years and been missed under their old name.
6. **Iwi, hapū, Pasifika, and cultural trusts** (if applicable): Indigenous and ethnic community development funds in the org's region.

For each gap, generate a specific web search query to find the missing funder's grants page.

Return a JSON object:
{ "queries": ["query 1", "query 2", ...] }

Generate 10–15 queries. Focus on the most likely gaps given the organisation's region and sector.`,
        },
        {
          role: 'user',
          content: `Country: ${market.country}
Operating regions: ${regionNames.join(', ') || 'nationwide'}
Funding purpose: ${fundingPurpose}${previousFunders ? `\nPrevious funders: ${previousFunders}` : ''}
Already identified funders: ${funderSample}

Identify gaps and generate search queries for missing funders.`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 800,
    }));
    if (costs) trackOpenAI(costs, 'gpt-4o-mini', res.usage);
    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
    const queries: string[] = Array.isArray(parsed.queries) ? parsed.queries : [];
    console.log(`[GrantSearch] Associative discovery: ${queries.length} gap-filling queries generated`);
    return queries;
  } catch {
    console.warn('[GrantSearch] Associative discovery failed');
    return [];
  }
}

// ─── Additional grant directory discovery ─────────────────────────────────────

/**
 * Asks GPT to suggest additional grant listing/aggregator websites for the
 * market, then validates each via Tavily search (hallucinated domains produce
 * zero results — self-correcting by design).
 */
async function discoverAdditionalDirectories(market: MarketConfig, costs?: CostTracker): Promise<string[]> {
  const discovered: string[] = [];
  try {
    const existingDomains = market.grantDirectories.map(d => {
      try { return new URL(d).hostname; } catch { return d; }
    }).join(', ');

    const res = await withRetry(() => openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a ${market.country} grant research expert. Identify grant listing websites, aggregators, and funding directories specific to ${market.country}.

These must be websites whose PRIMARY purpose is to list multiple grant opportunities — not individual funders' own sites. Think: grant finders, philanthropic databases, government grant portals, sector funding hubs.

For each site provide the domain and a site: search query to find active grant listings.

Return a JSON object:
{
  "directories": [
    { "name": "Funding Information NZ", "domain": "fundinginformation.org.nz", "searchQuery": "site:fundinginformation.org.nz grants apply ${CURRENT_YEAR}" }
  ]
}

Rules:
- Only include sites you are highly confident actually exist and list ${market.country} grants
- Do NOT include individual funder websites
- Do NOT repeat these already-known sites: ${existingDomains}
- Aim for 5–8 entries. Fewer confident entries is better than more uncertain ones.`,
        },
        { role: 'user', content: `Find additional grant directories for: ${market.country}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 600,
    }));

    if (costs) trackOpenAI(costs, 'gpt-4o-mini', res.usage);
    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
    const dirs: { searchQuery: string }[] = Array.isArray(parsed.directories) ? parsed.directories : [];

    // Validate each suggested directory via Tavily — hallucinated domains return zero results
    const validationTasks = dirs.map(d => async () => {
      try {
        if (costs) costs.serperQueries++;
        const r = await serperSearch(d.searchQuery.slice(0, 200), { num: 10, gl: market.id });
        r.results.forEach(hit => discovered.push(hit.url));
      } catch { /* domain doesn't exist or no results — harmless */ }
    });
    await withConcurrency(validationTasks, 5);
    console.log(`[GrantSearch] Additional directories: ${dirs.length} suggested, ${discovered.length} URLs validated`);
  } catch {
    console.warn('[GrantSearch] Additional directory discovery failed');
  }
  return discovered;
}

// ─── Broad categorical search generation ──────────────────────────────────────

/**
 * Generates a large number of broad search queries that find grants by CATEGORY
 * rather than by funder name. This discovers funders the enumeration step missed.
 * Covers: sector × region, grant type variations, activity-specific terms.
 */
async function generateBroadCategorySearches(
  market: MarketConfig,
  fundingPurpose: string,
  regionNames: string[],
  sectorLabels: string[],
): Promise<string[]> {
  const queries: string[] = [];
  const { country } = market;
  const regions = regionNames.length ? regionNames : [''];

  // Grant terminology variations — cast a wide net
  const grantTerms = [
    'grants apply', 'funding opportunities', 'community grants',
    'charitable trust grants', 'grant applications open',
    'funding available nonprofits', 'community fund apply',
  ];

  // Sector × region × grant term combinations
  for (const sector of sectorLabels) {
    for (const region of regions) {
      const loc = region ? `${region} ${country}` : country;
      queries.push(`${loc} ${sector} grants apply`);
      queries.push(`${sector} funding ${loc} nonprofits`);
      queries.push(`${sector} charitable trust ${loc}`);
    }
  }

  // Region-specific broad searches
  for (const region of regions) {
    const loc = region ? `${region} ${country}` : country;
    for (const term of grantTerms) {
      queries.push(`${loc} ${term}`);
    }
  }

  // Purpose-specific variations
  const purposeWords = fundingPurpose.split(/\s+/).filter(w => w.length > 4).slice(0, 5);
  for (const word of purposeWords) {
    queries.push(`${word} grants ${country} apply`);
    queries.push(`${word} funding ${country} nonprofits`);
    for (const region of regions.slice(0, 3)) {
      if (region) queries.push(`${region} ${word} grants apply`);
    }
  }

  // Grant type variations
  const grantTypes = ['project grants', 'operational funding', 'capital grants', 'programme funding', 'capacity building grants'];
  for (const type of grantTypes) {
    queries.push(`${country} ${type} nonprofits apply`);
  }

  const unique = [...new Set(queries)];
  console.log(`[GrantSearch] Broad category searches: ${unique.length} queries generated`);
  return unique;
}

// ─── Per-funder site crawling ────────────────────────────────────────────────

/**
 * For each unique funder domain found in search results, searches WITHIN that
 * domain for actual grant/apply pages. Many funder searches return homepages;
 * this step finds the actual grants pages buried deeper in the site.
 */
async function crawlFunderSites(
  domains: string[],
  market: MarketConfig,
  costs?: CostTracker,
): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  const crawlQueries = ['grants apply', 'funding apply', 'community grants', 'grant application'];

  const tasks = domains.map(domain => async () => {
    for (const q of crawlQueries) {
      try {
        if (costs) costs.serperQueries++;
        const r = await serperSearch(`site:${domain} ${q}`, {
          num: 10,
          gl: market.id,
        });
        r.results.forEach(hit => hits.push({ url: hit.url, snippet: hit.content }));
      } catch { /* skip */ }
    }
  });

  await withConcurrency(tasks, 20);
  console.log(`[GrantSearch] Site crawl: ${domains.length} domains → ${hits.length} grant page URLs found`);
  return hits;
}

// ─── Gap-fill query generation ─────────────────────────────────────────────────

async function generateGapFillQueries(
  market: MarketConfig,
  orgContext: string,
  foundDomains: string[],
  regionNames: string[],
  sectorLabels: string[],
  costs?: CostTracker,
): Promise<string[]> {
  try {
    const res = await withRetry(() => openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a ${market.country} grant research expert doing a SECOND-PASS gap analysis.

The first search pass already found results from these domains:
${foundDomains.slice(0, 40).join('\n')}

The organisation operates in: ${regionNames.join(', ') || 'nationwide'}.
Their sectors: ${sectorLabels.join(', ') || 'general community'}.

Identify what types of funders are MISSING and generate targeted search queries to find them. Focus on:
1. Small local charitable trusts and family foundations specific to the operating regions
2. District and town-level funders (more specific than regional — name actual towns and districts)
3. Sector-specific funds for ${sectorLabels.slice(0, 4).join(', ')} not yet found
4. Any well-known ${market.country} funder category absent from the found domains above
5. Recently established, rebranded, or niche foundations likely invisible to a first-pass search

Return JSON: { "queries": ["query 1", "query 2", ...] }

Generate 20–25 queries. Every query must target a gap — do not repeat searches that would return the already-found domains.`,
        },
        { role: 'user', content: orgContext },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 1500,
    }));
    if (costs) trackOpenAI(costs, 'gpt-4o-mini', res.usage);
    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
    const queries: string[] = Array.isArray(parsed.queries) ? parsed.queries : [];
    console.log(`[GrantSearch] Step 2b gap-fill: ${queries.length} second-pass queries`);
    return queries;
  } catch {
    console.warn('[GrantSearch] Gap-fill query generation failed');
    return [];
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as OrgInfo;
    const { website, fundingPurpose, fundingAmount, market: marketId } = body;
    if (!website || !fundingPurpose || !fundingAmount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const market = getMarket(marketId || 'nz');

    // ─── Cached mode: return DB-cached results immediately (free) ───
    if (SEARCH_MODE === 'cached') {
      const cached = await loadSearchResult(market.id);
      if (cached) {
        console.log(`[GrantSearch] CACHED MODE — returning ${cached.grants.length} cached grants (zero cost)`);
        return NextResponse.json(cached);
      }
      console.warn('[GrantSearch] CACHED MODE but no cached results found — falling through to full search');
    }

    const isGrantPage = buildIsGrantPage(market);
    const costs = createCostTracker();

    // Resolve region names from IDs
    const regionNames = (body.regions || [])
      .map(id => market.regions.find(r => r.id === id)?.name)
      .filter(Boolean) as string[];
    const regionText = regionNames.length ? regionNames.join(', ') : 'Nationwide';

    // Resolve sector labels
    const sectorLabels = (body.sectors || []).map(id => {
      const map: Record<string, string> = {
        'health': 'Health & Wellbeing', 'mental-health': 'Mental Health',
        'education': 'Education & Training', 'youth': 'Youth',
        'children-families': 'Children & Families', 'elderly': 'Elderly & Aged Care',
        'disability': 'Disability', 'arts-culture': 'Arts & Culture',
        'sport': 'Sport & Recreation', 'environment': 'Environment & Conservation',
        'housing': 'Housing & Homelessness', 'community': 'Community Development',
        'social-services': 'Social Services', 'indigenous': 'Indigenous Development',
        'rural': 'Rural Communities',
      };
      return map[id] || id;
    });

    const orgTypeLabel = {
      'registered-charity': 'Registered Charity',
      'charitable-trust': 'Charitable Trust',
      'incorporated-society': 'Incorporated Society',
      'social-enterprise': 'Social Enterprise',
      'community-group': 'Community Group',
      'other': 'Other',
    }[body.orgType || ''] || body.orgType || 'Unknown';

    const { PROGRAM_ENUMERATION_PROMPT, PAGE_EXTRACTION_PROMPT, SCORING_SYSTEM_PROMPT, RELEVANCE_TRIAGE_PROMPT } = buildPrompts(market, regionNames);

    const orgContext = `Organisation website: ${website}${body.linkedin ? `\nLinkedIn: ${body.linkedin}` : ''}
Organisation type: ${orgTypeLabel}
Operating regions: ${regionText}
Sectors: ${sectorLabels.join(', ') || 'Not specified'}
Funding purpose: ${fundingPurpose}
Amount sought: ${market.currency} ${market.currencySymbol}${fundingAmount.toLocaleString(market.locale)}${body.previousFunders ? `\nPrevious/current funders: ${body.previousFunders}` : ''}`;

    // ── Step 0 + Step 1 + Regional: Run in parallel ────────────────────────
    // Step 0 results are only needed at Step 3, so it runs in parallel with Step 1.
    // Regional search generation only needs fundingPurpose, so it starts immediately too.
    console.log(`[GrantSearch] Step 0: Discovering funders for market "${market.id}" (parallel with Step 1)`);
    const step0Promise = Promise.all([discoverFunderUrls(market, sectorLabels, regionNames, fundingPurpose, costs), discoverAdditionalDirectories(market, costs)]);
    const regionalPromise = generateRegionalSearches(market, fundingPurpose, regionNames, sectorLabels, costs);
    const dbFundersPromise = findMatchingCharities(body.sectors || [], regionNames, fundingPurpose);

    console.log('[GrantSearch] Step 1: Extracting org site + enumerating funders (4 category calls) + programs');

    // Build category-specific enumeration prompts (Change B)
    const { country } = market;
    const hintGroups = market.funderTypeGroups;
    function buildCategoryEnumerationPrompt(hintsSubset: string[]): string {
      const hintsText = hintsSubset.map(h => `- ${h}`).join('\n');
      return `You are a comprehensive ${country} grant research expert.

Your task: enumerate ALL specific named grant-giving organisations that operate in ${country} and fund non-profit community organisations. This is a knowledge recall task — draw entirely on your training data. The organisation details provided are used only to add a few sector-specific funders at the end that are especially relevant to their mission.

Enumerate funders across ALL of the following categories. Be exhaustive within each:
${hintsText}

Special instruction: for LOCAL COUNCILS / TERRITORIAL AUTHORITIES, list EVERY council individually by its full official name — do not summarise or group them.

For each funder, generate a targeted web search query designed to find their current active grant application page. The query must contain the exact organisation name, a descriptor ("grants", "apply", "community fund"), and the year ${CURRENT_YEAR}.

Return a JSON object:
{
  "funders": [
    { "name": "Pub Charity", "category": "Gaming Trust", "region": "national", "searchQuery": "Pub Charity grants apply ${country} ${CURRENT_YEAR}" },
    { "name": "Auckland Council", "category": "Local Council", "region": "Auckland", "searchQuery": "Auckland Council community grants apply ${CURRENT_YEAR}" }
  ]
}

Be exhaustive — do not set any target limit. List every funder you know within each category. For LOCAL COUNCILS specifically, list every individual council by name. Missing a genuine funder is the only failure mode.`;
    }

    const step1Promise = Promise.allSettled([
      tavilyClient.extract([website]),
      // 4 parallel category-group enumeration calls (indices 1–4)
      ...hintGroups.map(hintsSubset =>
        withRetry(() => openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: buildCategoryEnumerationPrompt(hintsSubset) },
            { role: 'user', content: orgContext },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_tokens: 14000,
        }))
      ),
      // Program enumeration — unchanged, always last (index 5)
      withRetry(() => openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: PROGRAM_ENUMERATION_PROMPT },
          { role: 'user', content: orgContext },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 3000,
      })),
    ]);

    const [[discoveredFunderUrls, additionalDirUrls], step1Results, regionalQueries]
      = await Promise.all([step0Promise, step1Promise, regionalPromise]);

    // Track Step 1 costs
    costs.tavilyUrls += 1; // org website extraction
    for (const result of step1Results.slice(1)) {
      if (result.status === 'fulfilled') {
        const completion = result.value as import('openai/resources/chat/completions').ChatCompletion;
        trackOpenAI(costs, completion.model || 'gpt-4o', completion.usage);
      }
    }

    // Await DB funder lookup (started in parallel with Step 0/1)
    const dbFunders = await dbFundersPromise;
    // Split DB funders: enriched ones (have grant summary) skip Tavily entirely;
    // unenriched ones contribute their grant URL or website URL for extraction.
    const enrichedDbFunders = dbFunders.filter(f => f.grantSummary);
    const unenrichedDbFunders = dbFunders.filter(f => !f.grantSummary);
    const dbFunderUrls = unenrichedDbFunders
      .map(f => f.grantUrl || f.url)
      .filter(Boolean);
    if (dbFunders.length > 0) {
      console.log(`[GrantSearch] Charities DB: ${dbFunders.length} matching (${enrichedDbFunders.length} enriched, ${dbFunderUrls.length} URLs for extraction)`);
    }

    // Prioritize URLs: curated + Serper-discovered first, then DB URLs to fill remaining capacity
    const TOTAL_URL_CAP = 200;
    const primaryUrls = Array.from(new Set([...discoveredFunderUrls, ...additionalDirUrls]));
    const remainingCap = Math.max(0, TOTAL_URL_CAP - primaryUrls.length);
    const cappedDbUrls = dbFunderUrls.slice(0, remainingCap);
    const allDiscoveredUrls = Array.from(new Set([...primaryUrls, ...cappedDbUrls]));
    if (dbFunderUrls.length > remainingCap) {
      console.log(`[GrantSearch] DB URLs capped: ${cappedDbUrls.length}/${dbFunderUrls.length} (total cap ${TOTAL_URL_CAP})`);
    }
    console.log(`[GrantSearch] Step 0+1 complete: ${allDiscoveredUrls.length} discovered URLs, ${regionalQueries.length} regional queries`);

    // Index 0: org extract
    const orgExtractResult = step1Results[0];
    // Indices 1–N: the category enumeration results (one per funderTypeGroup)
    const enumerationResults = step1Results.slice(1, 1 + hintGroups.length);
    // Index after enumeration groups: program enumeration
    const programEnumerationResult = step1Results[1 + hintGroups.length];

    const orgContent = orgExtractResult.status === 'fulfilled'
      ? ((orgExtractResult.value as Awaited<ReturnType<typeof tavilyClient.extract>>)?.results?.[0]?.rawContent?.slice(0, 3000) || '') : '';

    // Merge all category enumeration results, deduplicate by lowercased name
    let enumeratedFunders: EnumeratedFunder[] = [];
    const seenFunderNames = new Set<string>();
    for (const result of enumerationResults) {
      if (result.status !== 'fulfilled') continue;
      const raw = (result.value as import('openai/resources/chat/completions').ChatCompletion).choices[0]?.message?.content || '{}';
      let batch: EnumeratedFunder[] = [];
      try {
        const parsed = JSON.parse(raw);
        const arr = parsed.funders || [];
        if (Array.isArray(arr)) batch = arr as EnumeratedFunder[];
      } catch {
        // JSON was truncated — recover all complete funder objects already in the string
        const recovered = [...raw.matchAll(/\{\s*"name"\s*:\s*"([^"]+)"[^}]*"category"\s*:\s*"([^"]+)"[^}]*"region"\s*:\s*"([^"]+)"[^}]*"searchQuery"\s*:\s*"([^"]+)"[^}]*\}/g)]
          .map(m => ({ name: m[1], category: m[2], region: m[3], searchQuery: m[4] }));
        batch = recovered;
        console.warn(`[GrantSearch] Funder enumeration JSON truncated — recovered ${recovered.length} entries from partial output`);
      }
      for (const f of batch) {
        const key = f.name.toLowerCase().trim();
        if (!seenFunderNames.has(key)) {
          seenFunderNames.add(key);
          enumeratedFunders.push(f);
        }
      }
    }

    let enumeratedPrograms: EnumeratedProgram[] = [];
    if (programEnumerationResult.status === 'fulfilled') {
      try {
        const raw = (programEnumerationResult.value as import('openai/resources/chat/completions').ChatCompletion).choices[0]?.message?.content || '{}';
        const parsed = JSON.parse(raw);
        const arr = parsed.programs || [];
        if (Array.isArray(arr)) enumeratedPrograms = arr as EnumeratedProgram[];
      } catch { console.warn('[GrantSearch] Program enumeration parse failed'); }
    }
    console.log(`[GrantSearch] Step 1 complete: ${enumeratedFunders.length} funders (from ${hintGroups.length} category calls) + ${enumeratedPrograms.length} programs`);

    // Filter enumerated funders to user's regions + national (before Step 2 to reduce downstream costs)
    const preFilterCount = enumeratedFunders.length;
    enumeratedFunders = enumeratedFunders.filter(f => {
      const r = (f.region || '').toLowerCase().trim();
      // Keep national / nationwide / unspecified
      if (!r || r === 'national' || r === 'nationwide' || r === 'various' || r === 'multiple') return true;
      // Keep if region matches any of user's regions (substring match for flexibility)
      return regionNames.some(rn => r.includes(rn.toLowerCase()) || rn.toLowerCase().includes(r));
    });
    console.log(`[GrantSearch] Region filter: ${enumeratedFunders.length}/${preFilterCount} funders kept (${regionNames.join(', ')})`);

    // Start associative gap-fill (needs enumerated funders from Step 1)
    const associativePromise = generateAssociativeQueries(market, fundingPurpose, enumeratedFunders, regionNames, body.previousFunders || '', costs);

    // ── Step 2: Funder searches + program searches + seed queries ────────────
    // Kick off purpose seed generation + broad category searches in parallel
    const purposeSeedPromise = generatePurposeSeeds(market, fundingPurpose, orgContent, costs);
    const broadSearchPromise = generateBroadCategorySearches(market, fundingPurpose, regionNames, sectorLabels);

    const allEnumTargets = [...enumeratedFunders, ...enumeratedPrograms];
    console.log(`[GrantSearch] Step 2: Running ${allEnumTargets.length} enum searches + seed queries`);
    const rawSearchHits: SearchHit[] = [];
    const seedQueries = buildSeedQueries(market, fundingPurpose);

    const allSearchTasks = [
      ...allEnumTargets.map(f => async () => {
        try {
          const r = await serperSearch(f.searchQuery.slice(0, 400), {
            num: 10,
            gl: market.id,
            excludeDomains: market.excludedDomains,
          });
          costs.serperQueries++;
          r.results.forEach(hit =>
            rawSearchHits.push({ url: hit.url, snippet: hit.content, origin: 'enum' })
          );
        } catch { console.warn(`[GrantSearch] Search failed: ${f.name}`); }
      }),
      ...seedQueries.map(q => async () => {
        try {
          const r = await serperSearch(q, {
            num: 10,
            gl: market.id,
            excludeDomains: market.excludedDomains,
            });
          costs.serperQueries++;
          r.results.forEach(hit =>
            rawSearchHits.push({ url: hit.url, snippet: hit.content, origin: 'seed' })
          );
        } catch { console.warn('[GrantSearch] Seed search failed'); }
      }),
      // Regional search tasks (geography-aware queries from Step 0)
      ...regionalQueries.map(q => async () => {
        try {
          const r = await serperSearch(q.slice(0, 400), {
            num: 10,
            gl: market.id,
            excludeDomains: market.excludedDomains,
            });
          costs.serperQueries++;
          r.results.forEach(hit =>
            rawSearchHits.push({ url: hit.url, snippet: hit.content, origin: 'regional' })
          );
        } catch { console.warn('[GrantSearch] Regional search failed'); }
      }),
      // Aggregator deep-dive: search within known directories for org's sector/region
      ...market.grantDirectories.map(dir => async () => {
        try {
          const domain = new URL(dir).hostname;
          const r = await serperSearch(`site:${domain} ${fundingPurpose.slice(0, 80)}`, {
            num: 10,
            gl: market.id,
          });
          costs.serperQueries++;
          r.results.forEach(hit =>
            rawSearchHits.push({ url: hit.url, snippet: hit.content, origin: 'directory-deepdive' })
          );
        } catch { /* skip */ }
      }),
    ];

    // Start enum + static seed searches immediately — don't wait for purpose seeds
    const SEARCH_CONCURRENCY = 20;
    const enumSearchPromise = withConcurrency(allSearchTasks, SEARCH_CONCURRENCY);

    // Await purpose seeds (already running in parallel since start of Step 2)
    const purposeSeeds = await purposeSeedPromise;
    const purposeSeedTasks = purposeSeeds.map(q => async () => {
      try {
        const r = await serperSearch(q.slice(0, 400), {
          num: 10,
          gl: market.id,
          excludeDomains: market.excludedDomains,
        });
        costs.serperQueries++;
        r.results.forEach(hit =>
          rawSearchHits.push({ url: hit.url, snippet: hit.content, origin: 'purpose' })
        );
      } catch { console.warn('[GrantSearch] Purpose seed search failed'); }
    });

    // Await associative queries (started after Step 1 completed)
    const associativeQueries = await associativePromise;
    const associativeTasks = associativeQueries.map(q => async () => {
      try {
        const r = await serperSearch(q.slice(0, 400), {
          num: 10,
          gl: market.id,
          excludeDomains: market.excludedDomains,
        });
        costs.serperQueries++;
        r.results.forEach(hit =>
          rawSearchHits.push({ url: hit.url, snippet: hit.content, origin: 'associative' })
        );
      } catch { console.warn('[GrantSearch] Associative search failed'); }
    });

    // Await broad category searches (started at top of Step 2)
    const broadQueries = await broadSearchPromise;
    const broadTasks = broadQueries.map(q => async () => {
      try {
        const r = await serperSearch(q.slice(0, 400), {
          num: 10,
          gl: market.id,
          excludeDomains: market.excludedDomains,
        });
        costs.serperQueries++;
        r.results.forEach(hit =>
          rawSearchHits.push({ url: hit.url, snippet: hit.content, origin: 'broad' })
        );
      } catch { /* skip */ }
    });

    // Run all remaining search batches in parallel with enum searches
    await Promise.all([
      enumSearchPromise,
      withConcurrency(purposeSeedTasks, SEARCH_CONCURRENCY),
      withConcurrency(associativeTasks, SEARCH_CONCURRENCY),
      withConcurrency(broadTasks, SEARCH_CONCURRENCY),
    ]);

    // ── Step 2b: Gap-fill search ──────────────────────────────────────────────
    // Identify funder categories missing from the first pass and run targeted queries.
    {
      const foundDomains = [...new Set(rawSearchHits.map(h => {
        try { return new URL(h.url).hostname; } catch { return ''; }
      }).filter(Boolean))];
      const gapQueries = await generateGapFillQueries(market, orgContext, foundDomains, regionNames, sectorLabels, costs);
      if (gapQueries.length > 0) {
        const gapTasks = gapQueries.map(q => async () => {
          try {
            const r = await serperSearch(q.slice(0, 400), {
              num: 10,
              gl: market.id,
              excludeDomains: market.excludedDomains,
            });
            costs.serperQueries++;
            r.results.forEach(hit => rawSearchHits.push({ url: hit.url, snippet: hit.content, origin: 'gap-fill' }));
          } catch { /* skip */ }
        });
        await withConcurrency(gapTasks, SEARCH_CONCURRENCY);
        console.log(`[GrantSearch] Step 2b complete: ${gapQueries.length} gap-fill queries ran`);
      }
    }

    // ── Step 2c: Per-funder site crawl ────────────────────────────────────────
    // Many funder searches return homepages. Crawl within each found domain
    // to discover the actual grants/apply pages buried deeper in the site.
    if (ENABLE_SITE_CRAWL) {
      const allFoundDomains = [...new Set(rawSearchHits.map(h => {
        try {
          const host = new URL(h.url).hostname;
          return market.excludedDomains.some(d => host.endsWith(d) || host === d) ? '' : host;
        } catch { return ''; }
      }).filter(Boolean))];

      // Skip domains already at per-domain URL cap (3) — crawling them would
      // discover URLs that get discarded by the cap anyway, wasting Serper queries.
      const domainUrlCount = new Map<string, number>();
      for (const h of rawSearchHits) {
        try {
          const d = new URL(h.url).hostname;
          domainUrlCount.set(d, (domainUrlCount.get(d) || 0) + 1);
        } catch {}
      }
      const domainsNeedingCrawl = allFoundDomains.filter(d => (domainUrlCount.get(d) || 0) < 3);
      console.log(`[GrantSearch] Site crawl: ${domainsNeedingCrawl.length}/${allFoundDomains.length} domains need crawling (${allFoundDomains.length - domainsNeedingCrawl.length} already at cap)`);

      // Cap total crawl domains to avoid runaway Serper costs on the tail
      const CRAWL_DOMAIN_CAP = 200;
      const crawlDomains = domainsNeedingCrawl.slice(0, CRAWL_DOMAIN_CAP);
      if (domainsNeedingCrawl.length > CRAWL_DOMAIN_CAP) {
        console.log(`[GrantSearch] Site crawl: capped to ${CRAWL_DOMAIN_CAP} domains (skipped ${domainsNeedingCrawl.length - CRAWL_DOMAIN_CAP})`);
      }

      const siteCrawlHits = await crawlFunderSites(crawlDomains, market, costs);
      siteCrawlHits.forEach(hit => rawSearchHits.push({ ...hit, origin: 'site-crawl' }));
    } else {
      console.log(`[GrantSearch] Step 2c: Site crawl DISABLED`);
    }

    const uniqueSearchHits = deduplicateByUrl(rawSearchHits);
    const snippetByUrl = new Map(
      uniqueSearchHits.map(h => [normaliseUrl(h.url), h.snippet])
    );
    console.log(`[GrantSearch] Step 2 complete: ${rawSearchHits.length} raw hits → ${uniqueSearchHits.length} unique`);

    // Count raw hits per discovery step (before dedup) for diagnostics
    const rawCountByStep = new Map<DiscoveryStep, number>();
    for (const h of rawSearchHits) {
      const step = h.origin || 'unknown';
      rawCountByStep.set(step, (rawCountByStep.get(step) || 0) + 1);
    }

    // ── Step 3: Extract page content from all sources ─────────────────────────
    // Filter curated URLs by user's selected regions (national ones always included)
    const selectedRegionIds = new Set(body.regions || []);
    const filteredCuratedUrls = market.curatedFunderUrls
      .filter(entry => !entry.regions || entry.regions.length === 0 || entry.regions.some(r => selectedRegionIds.has(r)))
      .map(entry => entry.url);
    console.log(`[GrantSearch] Curated URLs: ${filteredCuratedUrls.length}/${market.curatedFunderUrls.length} after region filter (${selectedRegionIds.size} regions selected)`);

    // Union of: curated funder URLs + discovered URLs (Step 0) + search hits (Step 2)
    // Curated URLs bypass isGrantPage (hand-verified); discovered + search URLs are filtered
    // to avoid extracting non-grant pages (careers, login, news, etc.) at $0.008/URL.
    const dedupedUrls = deduplicateByUrl([
      ...filteredCuratedUrls.map(url => ({ url })),
      ...allDiscoveredUrls.map(url => ({ url })),
      ...uniqueSearchHits.map(h => ({ url: h.url })),
    ]).map(r => r.url);
    const curatedUrlSet = new Set(filteredCuratedUrls.map(normaliseUrl));
    const grantFilteredUrls = dedupedUrls.filter(url => curatedUrlSet.has(normaliseUrl(url)) || isGrantPage(url));
    const filtered = dedupedUrls.length - grantFilteredUrls.length;
    if (filtered > 0) console.log(`[GrantSearch] Pre-extraction filter: removed ${filtered} non-grant URLs`);

    // Per-domain cap: max 3 URLs per domain to avoid over-extracting one funder
    const MAX_PER_DOMAIN = 3;
    const domainCount = new Map<string, number>();
    const allUrlsToExtract: string[] = [];
    let domainCapped = 0;
    for (const url of grantFilteredUrls) {
      try {
        const domain = new URL(url).hostname;
        const count = domainCount.get(domain) || 0;
        if (count < MAX_PER_DOMAIN) {
          allUrlsToExtract.push(url);
          domainCount.set(domain, count + 1);
        } else {
          domainCapped++;
        }
      } catch {
        allUrlsToExtract.push(url); // keep malformed URLs, they'll fail gracefully
      }
    }
    if (domainCapped > 0) console.log(`[GrantSearch] Per-domain cap: removed ${domainCapped} URLs (max ${MAX_PER_DOMAIN}/domain)`);

    // Build URL→origin map for provenance tracking (priority: curated > directory > search hits)
    const urlOriginMap = new Map<string, DiscoveryStep>();
    for (const url of filteredCuratedUrls) {
      urlOriginMap.set(normaliseUrl(url), 'curated');
    }
    for (const url of allDiscoveredUrls) {
      const key = normaliseUrl(url);
      if (!urlOriginMap.has(key)) urlOriginMap.set(key, 'directory');
    }
    for (const h of uniqueSearchHits) {
      const key = normaliseUrl(h.url);
      if (!urlOriginMap.has(key)) urlOriginMap.set(key, h.origin || 'unknown');
    }

    // Track which origins survived per-domain capping
    const extractedOriginCounts = new Map<DiscoveryStep, number>();
    for (const url of allUrlsToExtract) {
      const origin = urlOriginMap.get(normaliseUrl(url)) || 'unknown';
      extractedOriginCounts.set(origin, (extractedOriginCounts.get(origin) || 0) + 1);
    }

    console.log(`[GrantSearch] Step 3: Extracting ${allUrlsToExtract.length} unique pages`);
    const extractedPages = await extractPages(allUrlsToExtract, snippetByUrl, costs);
    console.log(`[GrantSearch] Step 3a complete: ${extractedPages.length} pages with content`);

    // ── Step 3b: Retry failed extractions via search fallback ────────────────
    // When Tavily extract fails (JS-heavy sites, bot blocking, timeouts), search
    // for the domain + "grants" to get snippet content as a fallback.
    const extractedUrlSet = new Set(extractedPages.map(p => normaliseUrl(p.url)));
    const failedUrls = allUrlsToExtract.filter(u => !extractedUrlSet.has(normaliseUrl(u)));

    if (failedUrls.length > 0) {
      console.log(`[GrantSearch] Step 3b: ${failedUrls.length} URLs failed extraction — retrying via search`);

      // Group by domain to avoid redundant searches
      const failedDomains = new Map<string, string[]>();
      failedUrls.forEach(url => {
        try {
          const domain = new URL(url).hostname;
          if (!failedDomains.has(domain)) failedDomains.set(domain, []);
          failedDomains.get(domain)!.push(url);
        } catch { /* skip malformed URLs */ }
      });

      const retryTasks = [...failedDomains.entries()].map(([domain]) => async () => {
        try {
          const r = await serperSearch(`site:${domain} grants apply funding`, {
            num: 5,
            gl: market.id,
          });
          costs.serperQueries++;
          r?.results?.forEach(hit => {
            if (hit.content && hit.content.length > 100) {
              const hitKey = normaliseUrl(hit.url);
              if (!extractedUrlSet.has(hitKey)) {
                extractedPages.push({ url: hit.url, content: hit.content.slice(0, 8000) });
                extractedUrlSet.add(hitKey);
              }
            }
          });
        } catch { /* skip — domain may not exist or blocks all access */ }
      });

      await withConcurrency(retryTasks, 10);
      console.log(`[GrantSearch] Step 3b complete: ${extractedPages.length} total pages after retry (recovered ${extractedPages.length - (allUrlsToExtract.length - failedUrls.length)} via search)`);
    }

    // ── Step 3c: Snippet-only pages for still-unextracted URLs ────────────────
    // When Tavily extract AND the search-snippet fallback both fail, fall back to
    // the original Serper snippet if it's long enough to be informative (>200 chars).
    {
      let snippetCount = 0;
      // Promote snippets for URLs in the extraction list that still failed
      const stillMissing = allUrlsToExtract.filter(u => !extractedUrlSet.has(normaliseUrl(u)));
      for (const url of stillMissing) {
        const snippet = snippetByUrl.get(normaliseUrl(url));
        if (snippet && snippet.length > 200) {
          extractedPages.push({ url, content: snippet });
          extractedUrlSet.add(normaliseUrl(url));
          snippetCount++;
        }
      }
      // Also promote snippets for gap-fill URLs that weren't in allUrlsToExtract
      for (const hit of uniqueSearchHits) {
        const key = normaliseUrl(hit.url);
        if (!extractedUrlSet.has(key) && hit.snippet && hit.snippet.length > 200) {
          extractedPages.push({ url: hit.url, content: hit.snippet });
          extractedUrlSet.add(key);
          snippetCount++;
        }
      }
      if (snippetCount > 0) {
        console.log(`[GrantSearch] Step 3c: Added ${snippetCount} snippet-only pages`);
      }
    }

    // Inject enriched DB funders as synthetic pages (bypasses Tavily entirely)
    if (enrichedDbFunders.length > 0) {
      let injected = 0;
      for (const f of enrichedDbFunders) {
        const url = f.grantUrl || f.url;
        const key = normaliseUrl(url);
        if (!extractedUrlSet.has(key)) {
          extractedPages.push({
            url,
            content: `${f.name}\n\n${f.grantSummary}\n\nRegistered purpose: ${f.purpose || 'Not specified'}`,
          });
          extractedUrlSet.add(key);
          injected++;
        }
      }
      if (injected > 0) console.log(`[GrantSearch] Enriched DB funders: injected ${injected} pages (no Tavily cost)`);
    }

    if (!extractedPages.length) {
      return NextResponse.json({ grants: [], orgSummary: '', searchedAt: new Date().toISOString(), market: market.id });
    }

    // ── Step 4: GPT extracts grants from page content ─────────────────────────
    const grantPages = extractedPages.filter(p => isGrantPage(p.url));
    console.log(`[GrantSearch] Step 4: ${grantPages.length}/${extractedPages.length} pages after non-grant filter`);

    const PAGE_BATCH_SIZE = 4;
    const pageBatches: ExtractedPage[][] = [];
    for (let i = 0; i < grantPages.length; i += PAGE_BATCH_SIZE) {
      pageBatches.push(grantPages.slice(i, i + PAGE_BATCH_SIZE));
    }

    console.log(`[GrantSearch] Step 4: Extracting grants from ${pageBatches.length} page batches`);

    // Build page URL → origin map for provenance tracking during extraction
    const pageOriginMap = new Map<string, DiscoveryStep>();
    for (const p of grantPages) {
      const key = normaliseUrl(p.url);
      const origin = urlOriginMap.get(key);
      if (origin) pageOriginMap.set(key, origin);
    }

    const grantOriginMap = new Map<string, DiscoveryStep>();

    const extractionResults = await withConcurrency(
      pageBatches.map((pages, batchIdx) => async () => {
        // Determine the origins of pages in this batch for grant provenance
        const batchOrigins: DiscoveryStep[] = pages.map(p => {
          return pageOriginMap.get(normaliseUrl(p.url)) || urlOriginMap.get(normaliseUrl(p.url)) || 'unknown';
        });
        // Build domain→origin for this batch's pages (for fallback matching)
        const batchDomainOrigin = new Map<string, DiscoveryStep>();
        pages.forEach((p, i) => {
          try {
            const domain = new URL(p.url).hostname;
            if (!batchDomainOrigin.has(domain)) batchDomainOrigin.set(domain, batchOrigins[i]);
          } catch {}
        });
        // Most common origin in batch as last-resort fallback
        const fallbackOrigin = batchOrigins.filter(o => o !== 'unknown')[0] || batchOrigins[0];

        const pagesText = pages.map((p, i) =>
          `=== PAGE ${i + 1} ===\nURL: ${p.url}\n\n${p.content}`
        ).join('\n\n');
        try {
          const res = await withRetry(() => openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: PAGE_EXTRACTION_PROMPT },
              {
                role: 'user',
                content: `Organisation context:\n${orgContext}\n\nExtract all grant programs from these pages:\n\n${pagesText}`,
              },
            ],
            temperature: 0.1,
            max_tokens: 8000,
          }));
          trackOpenAI(costs, res.model || 'gpt-4o-mini', res.usage);
          const raw = stripFences(res.choices[0]?.message?.content || '');
          const parsed = JSON.parse(raw);
          const grants = Array.isArray(parsed) ? parsed as DiscoveredGrant[] : [];
          console.log(`[GrantSearch] Page batch ${batchIdx + 1}: ${grants.length} grants extracted`);

          // Assign origin to each grant: exact URL match → domain match → batch fallback
          for (const g of grants) {
            const key = normaliseUrl(g.url);
            let origin = urlOriginMap.get(key);
            if (!origin) {
              try {
                const domain = new URL(g.url).hostname;
                origin = batchDomainOrigin.get(domain);
              } catch {}
            }
            if (!origin) origin = fallbackOrigin;
            grantOriginMap.set(g.url, origin);
          }

          return grants;
        } catch (err) {
          console.warn(`[GrantSearch] Extraction batch ${batchIdx + 1} failed:`, err);
          return [] as DiscoveredGrant[];
        }
      }),
      15
    );

    const allDiscovered = deduplicateGrants(extractionResults.flat());
    console.log(`[GrantSearch] Step 4 complete: ${allDiscovered.length} unique grants`);

    if (!allDiscovered.length) {
      return NextResponse.json({ grants: [], orgSummary: '', searchedAt: new Date().toISOString(), market: market.id });
    }

    // ── Step 4.5: Relevance triage — DISABLED for now ─────────────────────
    // Was filtering too aggressively. Passing all grants directly to scoring.
    // TODO: re-enable with a more conservative prompt once we can compare results.

    // ── Step 5: Score in parallel batches ────────────────────────────────────
    const SCORE_BATCH = 25;
    const scoreBatches: DiscoveredGrant[][] = [];
    for (let i = 0; i < allDiscovered.length; i += SCORE_BATCH) {
      scoreBatches.push(allDiscovered.slice(i, i + SCORE_BATCH));
    }

    console.log(`[GrantSearch] Step 5: Scoring ${allDiscovered.length} grants in ${scoreBatches.length} batches`);

    const scoreResults = await withConcurrency(
      scoreBatches.map((batch, idx) => async () => {
        const isFirst = idx === 0;
        const grantsPayload = batch.map(g => ({
          name: g.name,
          funder: g.funder,
          type: g.type,
          description: g.description,
          amountMin: g.amountMin,
          amountMax: g.amountMax,
          url: g.url,
          pageContent: (g.pageContent || '').slice(0, 2000),
        }));

        try {
          const res = await withRetry(() => openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: SCORING_SYSTEM_PROMPT },
              {
                role: 'user',
                content: `${orgContext}\n\nOrganisation website content:\n${orgContent.slice(0, 1500)}\n\nToday: ${TODAY}\n${isFirst ? '' : 'Set orgSummary to empty string.\n'}\nScore ALL ${batch.length} grants. Return exactly ${batch.length} entries in the grants array.\n\n${JSON.stringify(grantsPayload, null, 2)}`,
              },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 16000,
          }));

          trackOpenAI(costs, res.model || 'gpt-4o', res.usage);
          const choice = res.choices[0];
          const raw = choice?.message?.content || '{}';
          console.log(`[GrantSearch] Score batch ${idx + 1}: finish_reason=${choice?.finish_reason}, input=${batch.length}`);

          const parsed = JSON.parse(raw);
          const grantsArr: GrantOpportunity[] = parsed.grants || [];
          console.log(`[GrantSearch] Score batch ${idx + 1}: ${grantsArr.length}/${batch.length} scored`);

          const valid = grantsArr
            .filter((g: GrantOpportunity) => g?.scores !== undefined)
            .map((g: GrantOpportunity) => {
              if (!g.scores.overall) {
                const { alignment = 0, ease = 5, attainability = 0 } = g.scores;
                g.scores.overall = Math.round(((alignment * 0.5) + (attainability * 0.3) + (ease * 0.2)) * 10) / 10;
              }
              return g;
            });

          return { orgSummary: isFirst ? (parsed.orgSummary || '') : '', grants: valid };
        } catch (err) {
          console.error(`[GrantSearch] Score batch ${idx + 1} failed:`, err);
          return null;
        }
      }),
      15
    );

    const orgSummary = (scoreResults[0] as { orgSummary?: string })?.orgSummary || '';
    const grants = scoreResults
      .flatMap(r => r?.grants || [])
      .filter(g => (g.scores?.alignment ?? 0) >= 5)
      .map((g, i) => ({ ...g, id: g.id || `grant-${i}-${Date.now()}` }));

    const costBreakdown = computeCost(costs);
    console.log(`[GrantSearch] Done — ${grants.length} scored grants`);
    console.log(`[GrantSearch] Cost breakdown:`, {
      'GPT-4o': `$${costBreakdown.openai4o.toFixed(4)} (${costs.gpt4oIn} in / ${costs.gpt4oOut} out tokens)`,
      'GPT-4o-mini': `$${costBreakdown.openaiMini.toFixed(4)} (${costs.gpt4oMiniIn} in / ${costs.gpt4oMiniOut} out tokens)`,
      'Tavily': `$${costBreakdown.tavily.toFixed(4)} (${costs.tavilyUrls} URLs)`,
      'Serper': `$${costBreakdown.serper.toFixed(4)} (${costs.serperQueries} queries)`,
      'TOTAL': `$${costBreakdown.total.toFixed(4)}`,
    });

    // ── Pipeline Diagnostics ──────────────────────────────────────────────────
    const ALL_STEPS: DiscoveryStep[] = ['curated', 'directory', 'enum', 'seed', 'regional',
      'directory-deepdive', 'purpose', 'associative', 'broad', 'gap-fill', 'site-crawl', 'db-enrichment'];

    const stepStats: Record<string, {
      rawUrls: number;
      uniqueUrls: number;
      extractedUrls: number;
      grantsFound: number;
      grantsKept: number;
      scores: number[];
    }> = {};

    for (const step of ALL_STEPS) {
      stepStats[step] = {
        rawUrls: rawCountByStep.get(step) || 0,
        uniqueUrls: [...urlOriginMap.values()].filter(o => o === step).length,
        extractedUrls: extractedOriginCounts.get(step) || 0,
        grantsFound: [...grantOriginMap.values()].filter(o => o === step).length,
        grantsKept: 0,
        scores: [],
      };
    }

    for (const g of grants) {
      const origin = grantOriginMap.get(g.url) || 'unknown';
      if (stepStats[origin]) {
        stepStats[origin].grantsKept++;
        stepStats[origin].scores.push(g.scores?.overall ?? 0);
      }
    }

    // Log formatted diagnostic table
    const hdr = `${'Step'.padEnd(20)} ${'Raw URLs'.padStart(10)} ${'Unique'.padStart(8)} ${'Extracted'.padStart(10)} ${'Grants'.padStart(8)} ${'Kept'.padStart(6)} ${'Avg Score'.padStart(10)}`;
    const sep = '\u2500'.repeat(78);
    console.log(`\n[GrantSearch] \u2550\u2550\u2550 PIPELINE DIAGNOSTICS \u2550\u2550\u2550`);
    console.log(hdr);
    console.log(sep);
    const totals = { raw: 0, unique: 0, extracted: 0, found: 0, kept: 0, allScores: [] as number[] };
    for (const [step, s] of Object.entries(stepStats)) {
      if (s.rawUrls === 0 && s.uniqueUrls === 0 && s.grantsKept === 0) continue;
      const avg = s.scores.length > 0 ? (s.scores.reduce((a, b) => a + b, 0) / s.scores.length).toFixed(1) : '\u2014';
      console.log(`${step.padEnd(20)} ${String(s.rawUrls).padStart(10)} ${String(s.uniqueUrls).padStart(8)} ${String(s.extractedUrls).padStart(10)} ${String(s.grantsFound).padStart(8)} ${String(s.grantsKept).padStart(6)} ${String(avg).padStart(10)}`);
      totals.raw += s.rawUrls; totals.unique += s.uniqueUrls; totals.extracted += s.extractedUrls;
      totals.found += s.grantsFound; totals.kept += s.grantsKept; totals.allScores.push(...s.scores);
    }
    // Add unknown row if any grants couldn't be traced
    const unknownKept = grants.filter(g => {
      const o = grantOriginMap.get(g.url);
      return !o || o === 'unknown';
    }).length;
    if (unknownKept > 0) {
      const unknownScores = grants.filter(g => !grantOriginMap.get(g.url) || grantOriginMap.get(g.url) === 'unknown').map(g => g.scores?.overall ?? 0);
      const avg = unknownScores.length > 0 ? (unknownScores.reduce((a, b) => a + b, 0) / unknownScores.length).toFixed(1) : '\u2014';
      console.log(`${'unknown'.padEnd(20)} ${''.padStart(10)} ${''.padStart(8)} ${''.padStart(10)} ${''.padStart(8)} ${String(unknownKept).padStart(6)} ${String(avg).padStart(10)}`);
      totals.kept += unknownKept; totals.allScores.push(...unknownScores);
    }
    console.log(sep);
    const totalAvg = totals.allScores.length > 0 ? (totals.allScores.reduce((a, b) => a + b, 0) / totals.allScores.length).toFixed(1) : '\u2014';
    console.log(`${'TOTAL'.padEnd(20)} ${String(totals.raw).padStart(10)} ${String(totals.unique).padStart(8)} ${String(totals.extracted).padStart(10)} ${String(totals.found).padStart(8)} ${String(totals.kept).padStart(6)} ${String(totalAvg).padStart(10)}`);
    console.log('');

    // Strip scores arrays before sending to client (just for logging)
    const diagnostics: Record<string, { rawUrls: number; uniqueUrls: number; extractedUrls: number; grantsFound: number; grantsKept: number; avgScore: number | null }> = {};
    for (const [step, s] of Object.entries(stepStats)) {
      if (s.rawUrls === 0 && s.uniqueUrls === 0 && s.grantsKept === 0) continue;
      diagnostics[step] = {
        rawUrls: s.rawUrls,
        uniqueUrls: s.uniqueUrls,
        extractedUrls: s.extractedUrls,
        grantsFound: s.grantsFound,
        grantsKept: s.grantsKept,
        avgScore: s.scores.length > 0 ? Math.round((s.scores.reduce((a, b) => a + b, 0) / s.scores.length) * 10) / 10 : null,
      };
    }

    const result: SearchResult = {
      grants,
      orgSummary,
      searchedAt: new Date().toISOString(),
      market: market.id,
      inputs: body,
      diagnostics,
    };

    // Cache the result for future free searches
    await saveSearchResult(market.id, body, result);

    return NextResponse.json(result);

  } catch (err) {
    console.error('[GrantSearch] API error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
