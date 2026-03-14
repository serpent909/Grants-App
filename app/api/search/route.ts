import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { tavilyClient } from '@/lib/tavily';
import { OrgInfo, GrantOpportunity, SearchResult } from '@/lib/types';
import { getMarket, MarketConfig } from '@/lib/markets';

const TODAY = new Date().toISOString().split('T')[0];
const CURRENT_YEAR = new Date().getFullYear();

// ─── Prompt factory ───────────────────────────────────────────────────────────

/**
 * Build all three prompts parameterised for the given market.
 * No market-specific strings live outside this function.
 */
function buildPrompts(market: MarketConfig) {
  const { country, currency } = market;
  const hintsText = market.funderTypeHints.map(h => `- ${h}`).join('\n');

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
- Only extract grants EXPLICITLY described on the page. Never add grants from training memory.
- Extract ALL grants on the page regardless of whether they seem relevant to the org — scoring will assess fit.
  Only skip grants that are clearly impossible for any non-profit to apply to (e.g. grants exclusively for commercial businesses or government agencies).
- Do NOT extract a grant ONLY if the page explicitly states it is closed or shows a past closing date. If no closing date is mentioned, or if the status is unclear, extract the grant — many grants run on rolling or annual cycles without stating "open" on the page.
- Use current organisation names.
- URL: use the source page URL unless the page explicitly links to a more specific application page for that exact grant program.
- amountMin/amountMax in ${currency} integers if stated, otherwise omit those fields.
- pageContent: copy a verbatim 800-char excerpt from the page most relevant to this specific grant — prioritise eligibility criteria, funded activities, deadlines, and grant amounts.

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
    "pageContent": "verbatim 800-char excerpt covering eligibility, purpose, deadline, amounts"
  }
]`;

  const SCORING_SYSTEM_PROMPT = `You are an expert ${country} grant researcher. Score each grant program for a specific organisation.

Scoring dimensions (0–10):
alignment — how well the grant purpose matches the org mission AND specific funding request
  0-3 poor match | 4-6 partial overlap | 7-8 good match | 9-10 designed for exactly this

applicationDifficulty — complexity of the application process
  1-2 simple online form | 3-4 moderate effort | 5-6 full proposal | 7-8 complex/extensive | 9-10 multi-stage/site visits

attainability — likelihood this org wins given competition and eligibility fit
  1-2 very competitive/national funder | 3-4 competitive | 5-6 moderate | 7-8 regional/less competitive | 9-10 strong match, few applicants

overall = (alignment × 0.5) + (attainability × 0.3) + ((10 − applicationDifficulty) × 0.2), rounded to 1dp

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
      "scores": { "alignment": 8, "applicationDifficulty": 4, "attainability": 6, "overall": 7.2 },
      "alignmentReason": "1-2 sentences explaining alignment with this org's specific mission and funding request",
      "applicationNotes": "1-2 sentences on application process complexity and what is required",
      "attainabilityNotes": "1-2 sentences on competition level and why this org is or isn't a strong candidate"
    }
  ]
}`;

  return { FUNDER_ENUMERATION_PROMPT, PROGRAM_ENUMERATION_PROMPT, PAGE_EXTRACTION_PROMPT, SCORING_SYSTEM_PROMPT };
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

function buildIsGrantPage(market: MarketConfig): (url: string) => boolean {
  return (url: string) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return !market.excludedDomains.some(d => host.endsWith(d) || host === d);
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

interface SearchHit {
  url: string;
  snippet: string;
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
    const key = r.url?.toLowerCase().split('?')[0];
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateGrants(grants: DiscoveredGrant[]): DiscoveredGrant[] {
  const seen = new Set<string>();
  return grants.filter(g => {
    const key = `${g.funder.toLowerCase().trim()}||${g.name.toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripFences(text: string): string {
  return text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
}

const normaliseUrl = (url: string) => url.toLowerCase().split('?')[0];

/**
 * Extract full page content via Tavily.
 * snippetFallback: map of normalised URL → search snippet used when Tavily extract fails.
 * Many corporate/government sites block scrapers — snippets ensure we still get content.
 */
async function extractPages(
  urls: string[],
  snippetFallback?: Map<string, string>,
): Promise<ExtractedPage[]> {
  if (!urls.length) return [];
  const pages: ExtractedPage[] = [];
  const BATCH = 20;

  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH);
    const extracted = new Set<string>();

    try {
      const result = await tavilyClient.extract(batch);
      result?.results?.forEach((r, j) => {
        if (r?.rawContent && batch[j]) {
          pages.push({ url: batch[j], content: r.rawContent.slice(0, 4000) });
          extracted.add(normaliseUrl(batch[j]));
        }
      });
    } catch (err) {
      console.warn(`[GrantSearch] Extract batch ${Math.floor(i / BATCH) + 1} failed:`, err);
    }

    // Fallback: use search snippet for any URL that failed full extraction
    if (snippetFallback) {
      batch.forEach(url => {
        const key = normaliseUrl(url);
        if (!extracted.has(key)) {
          const snippet = snippetFallback.get(key);
          if (snippet && snippet.length > 150) {
            pages.push({ url, content: snippet });
            console.log(`[GrantSearch] Snippet fallback: ${url}`);
          }
        }
      });
    }
  }
  return pages;
}

// ─── Step 0: Dynamic funder discovery ────────────────────────────────────────

/**
 * Dynamically discover funder URLs for a market by:
 *   0a: Extracting grant directory pages and harvesting links from their content
 *   0b: Running site: searches against each directory domain
 *
 * For NZ this is additive (curatedPages already covers known funders).
 * For new markets (AU, UK, etc.) this is the primary funder discovery mechanism.
 */
async function discoverFunderUrls(market: MarketConfig): Promise<string[]> {
  const discovered: string[] = [];

  // 0a: Extract directory pages and harvest embedded funder links
  const directoryPages = await extractPages(market.grantDirectories);
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
            && !market.excludedDomains.some(ex => host.endsWith(ex) || host === ex)
            && /grant|fund|apply|donat|philanthrop/i.test(u);
        } catch { return false; }
      })
      .forEach(u => discovered.push(u));
  }

  // 0b: site: searches against each directory domain to find indexed grant sub-pages
  const siteTasks = market.grantDirectories.map(dir => async () => {
    try {
      const domain = new URL(dir).hostname;
      const r = await tavilyClient.search(`site:${domain} grants apply`, {
        maxResults: 20,
        searchDepth: 'basic',
        includeAnswer: false,
      });
      r?.results?.forEach(hit => discovered.push(hit.url));
    } catch { /* ignore individual failures */ }
  });
  await withConcurrency(siteTasks, 5);

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
): Promise<string[]> {
  try {
    const res = await withRetry(() => openai.chat.completions.create({
      model: 'gpt-4o',
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
    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
    const queries: string[] = Array.isArray(parsed.queries) ? parsed.queries : [];
    console.log(`[GrantSearch] Purpose seeds: ${queries.length} queries generated`);
    return queries;
  } catch {
    console.warn('[GrantSearch] Purpose seed generation failed');
    return [];
  }
}

// ─── Additional grant directory discovery ─────────────────────────────────────

/**
 * Asks GPT to suggest additional grant listing/aggregator websites for the
 * market, then validates each via Tavily search (hallucinated domains produce
 * zero results — self-correcting by design).
 */
async function discoverAdditionalDirectories(market: MarketConfig): Promise<string[]> {
  const discovered: string[] = [];
  try {
    const existingDomains = market.grantDirectories.map(d => {
      try { return new URL(d).hostname; } catch { return d; }
    }).join(', ');

    const res = await withRetry(() => openai.chat.completions.create({
      model: 'gpt-4o',
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

    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
    const dirs: { searchQuery: string }[] = Array.isArray(parsed.directories) ? parsed.directories : [];

    // Validate each suggested directory via Tavily — hallucinated domains return zero results
    const validationTasks = dirs.map(d => async () => {
      try {
        const r = await tavilyClient.search(d.searchQuery.slice(0, 200), {
          maxResults: 10,
          searchDepth: 'basic',
          includeAnswer: false,
        });
        r?.results?.forEach(hit => discovered.push(hit.url));
      } catch { /* domain doesn't exist or no results — harmless */ }
    });
    await withConcurrency(validationTasks, 5);
    console.log(`[GrantSearch] Additional directories: ${dirs.length} suggested, ${discovered.length} URLs validated`);
  } catch {
    console.warn('[GrantSearch] Additional directory discovery failed');
  }
  return discovered;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as OrgInfo;
    const { website, linkedin, fundingPurpose, fundingAmount, market: marketId } = body;
    if (!website || !linkedin || !fundingPurpose || !fundingAmount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const market = getMarket(marketId || 'nz');
    const { FUNDER_ENUMERATION_PROMPT, PROGRAM_ENUMERATION_PROMPT, PAGE_EXTRACTION_PROMPT, SCORING_SYSTEM_PROMPT } = buildPrompts(market);
    const isGrantPage = buildIsGrantPage(market);

    const orgContext = `Organisation website: ${website}
LinkedIn: ${linkedin}
Funding purpose: ${fundingPurpose}
Amount sought: ${market.currency} ${market.currencySymbol}${fundingAmount.toLocaleString(market.locale)}`;

    // ── Step 0: Dynamic funder discovery + additional directory search ────────
    console.log(`[GrantSearch] Step 0: Discovering funders for market "${market.id}"`);
    const [discoveredFunderUrls, additionalDirUrls] = await Promise.all([
      discoverFunderUrls(market),
      discoverAdditionalDirectories(market),
    ]);
    const allDiscoveredUrls = [...new Set([...discoveredFunderUrls, ...additionalDirUrls])];
    console.log(`[GrantSearch] Step 0 complete: ${allDiscoveredUrls.length} total discovered URLs`);

    // ── Step 1: Extract org site + enumerate funders + enumerate programs (parallel)
    console.log('[GrantSearch] Step 1: Extracting org site + enumerating funders + programs');
    const [orgExtractResult, enumerationResult, programEnumerationResult] = await Promise.allSettled([
      tavilyClient.extract([website]),
      withRetry(() => openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: FUNDER_ENUMERATION_PROMPT },
          { role: 'user', content: orgContext },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 6000,
      })),
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

    const orgContent = orgExtractResult.status === 'fulfilled'
      ? (orgExtractResult.value?.results?.[0]?.rawContent?.slice(0, 3000) || '') : '';

    let enumeratedFunders: EnumeratedFunder[] = [];
    if (enumerationResult.status === 'fulfilled') {
      try {
        const raw = enumerationResult.value.choices[0]?.message?.content || '{}';
        const parsed = JSON.parse(raw);
        const arr = parsed.funders || [];
        if (Array.isArray(arr)) enumeratedFunders = arr as EnumeratedFunder[];
      } catch { console.warn('[GrantSearch] Funder enumeration parse failed'); }
    }

    let enumeratedPrograms: EnumeratedProgram[] = [];
    if (programEnumerationResult.status === 'fulfilled') {
      try {
        const raw = programEnumerationResult.value.choices[0]?.message?.content || '{}';
        const parsed = JSON.parse(raw);
        const arr = parsed.programs || [];
        if (Array.isArray(arr)) enumeratedPrograms = arr as EnumeratedProgram[];
      } catch { console.warn('[GrantSearch] Program enumeration parse failed'); }
    }
    console.log(`[GrantSearch] Step 1 complete: ${enumeratedFunders.length} funders + ${enumeratedPrograms.length} programs`);

    // ── Step 2: Funder searches + program searches + seed queries ────────────
    // Kick off purpose seed generation in parallel while searches run
    const purposeSeedPromise = generatePurposeSeeds(market, fundingPurpose, orgContent);

    const allEnumTargets = [...enumeratedFunders, ...enumeratedPrograms];
    console.log(`[GrantSearch] Step 2: Running ${allEnumTargets.length} enum searches + seed queries`);
    const rawSearchHits: SearchHit[] = [];
    const seedQueries = buildSeedQueries(market, fundingPurpose);

    const allSearchTasks = [
      ...allEnumTargets.map(f => async () => {
        try {
          const r = await tavilyClient.search(f.searchQuery.slice(0, 400), {
            maxResults: 5,
            searchDepth: 'basic',
            includeAnswer: false,
          });
          r?.results?.slice(0, 5).forEach(hit =>
            rawSearchHits.push({ url: hit.url, snippet: hit.content || '' })
          );
        } catch { console.warn(`[GrantSearch] Search failed: ${f.name}`); }
      }),
      ...seedQueries.map(q => async () => {
        try {
          const r = await tavilyClient.search(q, {
            maxResults: 10,
            searchDepth: 'advanced',
            includeAnswer: false,
            days: 400,
          });
          r?.results?.forEach(hit =>
            rawSearchHits.push({ url: hit.url, snippet: hit.content || '' })
          );
        } catch { console.warn('[GrantSearch] Seed search failed'); }
      }),
    ];

    // Run all enum + static seed searches; purpose seeds join as they resolve
    const purposeSeeds = await purposeSeedPromise;
    const purposeSeedTasks = purposeSeeds.map(q => async () => {
      try {
        const r = await tavilyClient.search(q.slice(0, 400), {
          maxResults: 10,
          searchDepth: 'advanced',
          includeAnswer: false,
          days: 400,
        });
        r?.results?.forEach(hit =>
          rawSearchHits.push({ url: hit.url, snippet: hit.content || '' })
        );
      } catch { console.warn('[GrantSearch] Purpose seed search failed'); }
    });
    await withConcurrency([...allSearchTasks, ...purposeSeedTasks], 10);

    const uniqueSearchHits = deduplicateByUrl(rawSearchHits);
    const snippetByUrl = new Map(
      uniqueSearchHits.map(h => [normaliseUrl(h.url), h.snippet])
    );
    console.log(`[GrantSearch] Step 2 complete: ${rawSearchHits.length} raw hits → ${uniqueSearchHits.length} unique`);

    // ── Step 3: Extract page content from all sources ─────────────────────────
    // Union of: curated pages + all discovered URLs (Step 0) + search hits (Step 2)
    const allUrlsToExtract = deduplicateByUrl([
      ...(market.curatedPages ?? []).map(url => ({ url })),
      ...allDiscoveredUrls.map(url => ({ url })),
      ...uniqueSearchHits.map(h => ({ url: h.url })),
    ]).map(r => r.url);

    console.log(`[GrantSearch] Step 3: Extracting ${allUrlsToExtract.length} unique pages`);
    const extractedPages = await extractPages(allUrlsToExtract, snippetByUrl);
    console.log(`[GrantSearch] Step 3 complete: ${extractedPages.length} pages with content`);

    if (!extractedPages.length) {
      return NextResponse.json({ grants: [], orgSummary: '', searchedAt: new Date().toISOString(), market: market.id });
    }

    // ── Step 4: GPT extracts grants from page content ─────────────────────────
    const grantPages = extractedPages.filter(p => isGrantPage(p.url));
    console.log(`[GrantSearch] Step 4: ${grantPages.length}/${extractedPages.length} pages after non-grant filter`);

    const PAGE_BATCH_SIZE = 2;
    const pageBatches: ExtractedPage[][] = [];
    for (let i = 0; i < grantPages.length; i += PAGE_BATCH_SIZE) {
      pageBatches.push(grantPages.slice(i, i + PAGE_BATCH_SIZE));
    }

    console.log(`[GrantSearch] Step 4: Extracting grants from ${pageBatches.length} page batches`);

    const extractionResults = await withConcurrency(
      pageBatches.map((pages, batchIdx) => async () => {
        const pagesText = pages.map((p, i) =>
          `=== PAGE ${i + 1} ===\nURL: ${p.url}\n\n${p.content}`
        ).join('\n\n');
        try {
          const res = await withRetry(() => openai.chat.completions.create({
            model: 'gpt-4o',
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
          const raw = stripFences(res.choices[0]?.message?.content || '');
          const parsed = JSON.parse(raw);
          const grants = Array.isArray(parsed) ? parsed as DiscoveredGrant[] : [];
          console.log(`[GrantSearch] Page batch ${batchIdx + 1}: ${grants.length} grants extracted`);
          return grants;
        } catch (err) {
          console.warn(`[GrantSearch] Extraction batch ${batchIdx + 1} failed:`, err);
          return [] as DiscoveredGrant[];
        }
      }),
      10
    );

    const allDiscovered = deduplicateGrants(extractionResults.flat());
    console.log(`[GrantSearch] Step 4 complete: ${allDiscovered.length} unique grants`);

    if (!allDiscovered.length) {
      return NextResponse.json({ grants: [], orgSummary: '', searchedAt: new Date().toISOString(), market: market.id });
    }

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
          pageContent: (g.pageContent || '').slice(0, 600),
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
                const { alignment = 0, applicationDifficulty = 5, attainability = 0 } = g.scores;
                g.scores.overall = Math.round(((alignment * 0.5) + (attainability * 0.3) + ((10 - applicationDifficulty) * 0.2)) * 10) / 10;
              }
              return g;
            });

          return { orgSummary: isFirst ? (parsed.orgSummary || '') : '', grants: valid };
        } catch (err) {
          console.error(`[GrantSearch] Score batch ${idx + 1} failed:`, err);
          return null;
        }
      }),
      10
    );

    const orgSummary = (scoreResults[0] as { orgSummary?: string })?.orgSummary || '';
    const grants = scoreResults
      .flatMap(r => r?.grants || [])
      .map((g, i) => ({ ...g, id: g.id || `grant-${i}-${Date.now()}` }));

    console.log(`[GrantSearch] Done — ${grants.length} scored grants`);

    return NextResponse.json({
      grants,
      orgSummary,
      searchedAt: new Date().toISOString(),
      market: market.id,
    } as SearchResult);

  } catch (err) {
    console.error('[GrantSearch] API error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
