import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { tavilyClient } from '@/lib/tavily';
import { serperSearch } from '@/lib/serper';
import { getMarket } from '@/lib/markets';

const TODAY = new Date().toISOString().split('T')[0];
const CURRENT_YEAR = new Date().getFullYear();

export interface DiagnoseFunderInput {
  name: string;
  url?: string;
}

export interface DiagnoseFunderResult {
  name: string;
  url?: string;
  // Step A: Enumeration
  wasEnumerated: boolean;
  enumeratedAs?: string;
  enumeratedSearchQuery?: string;
  // Step B: Search
  searchUrls: string[];
  bestSearchUrl?: string;
  // Step C: Extraction
  testedUrl?: string;
  extractionStatus: 'not-tested' | 'success' | 'failed' | 'blocked';
  extractedSnippet?: string;
  // Step D: GPT grant detection
  gptFoundGrants?: boolean;
  gptGrantNames?: string[];
  gptReason?: string;
  // Summary
  failureStage: 'enumeration' | 'search' | 'extraction' | 'gpt-extraction' | 'none' | 'unknown';
  diagnosis: string;
}

export interface DiagnoseResponse {
  market: string;
  orgContext: string;
  enumeratedCount: number;
  enumeratedFunders: string[];
  results: DiagnoseFunderResult[];
  durationMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Words too generic to use as fuzzy-match signals in a grant context — they appear
// in almost every funder name and would produce false-positive matches.
const GENERIC_GRANT_WORDS = new Set([
  'trust', 'foundation', 'community', 'charitable', 'charity', 'grants',
  'grant', 'funding', 'funds', 'fund', 'society', 'association', 'council',
  'group', 'network', 'centre', 'center', 'institute', 'organisation', 'organization',
]);

function fuzzyMatch(a: string, b: string): boolean {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const ca = clean(a);
  const cb = clean(b);
  if (ca === cb) return true;
  if (ca.includes(cb) || cb.includes(ca)) return true;
  // Only use single-word partial matching for specific, non-generic words
  return ca.split(' ').some(w =>
    w.length > 4 && !GENERIC_GRANT_WORDS.has(w) && cb.includes(w)
  );
}

function buildEnumerationPrompt(country: string, hintsText: string) {
  return `You are a comprehensive ${country} grant research expert.

Your task: enumerate ALL specific named grant-giving organisations that operate in ${country} and fund non-profit community organisations. This is a knowledge recall task — draw entirely on your training data. The organisation details provided are used only to add 10–15 sector-specific funders at the end that are especially relevant to their mission.

Enumerate funders across ALL of the following categories. Be exhaustive within each:
${hintsText}

Special instruction: for LOCAL COUNCILS / TERRITORIAL AUTHORITIES, list EVERY council individually by its full official name — do not summarise or group them.

For each funder, generate a targeted web search query designed to find their current active grant application page. The query must contain the exact organisation name, a descriptor ("grants", "apply", "community fund"), and the year ${CURRENT_YEAR}.

Return a JSON object:
{
  "funders": [
    { "name": "Pub Charity", "category": "Gaming Trust", "region": "national", "searchQuery": "Pub Charity grants apply ${country} ${CURRENT_YEAR}" }
  ]
}

Aim for 80–150 funders. Prefer more over fewer.`;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const start = Date.now();
  try {
    const body = await req.json();
    const {
      website, fundingPurpose, fundingAmount,
      market: marketId, regions, sectors, orgType, previousFunders,
      expectedFunders = [],
    } = body as {
      website: string;
      fundingPurpose: string;
      fundingAmount: number;
      market: string;
      regions?: string[];
      sectors?: string[];
      orgType?: string;
      previousFunders?: string;
      expectedFunders: DiagnoseFunderInput[];
    };

    const market = getMarket(marketId || 'nz');

    const regionNames = (regions || [])
      .map(id => market.regions.find(r => r.id === id)?.name)
      .filter(Boolean) as string[];

    const orgContext = `Organisation website: ${website}
Organisation type: ${orgType || 'Not specified'}
Operating regions: ${regionNames.join(', ') || 'Nationwide'}
Sectors: ${(sectors || []).join(', ') || 'Not specified'}
Funding purpose: ${fundingPurpose}
Amount sought: ${market.currency} ${fundingAmount}${previousFunders ? `\nPrevious/current funders: ${previousFunders}` : ''}`;

    // ── Step A: Run funder enumeration ────────────────────────────────────────
    const hintsText = market.funderTypeHints.map(h => `- ${h}`).join('\n');
    const enumerationPrompt = buildEnumerationPrompt(market.country, hintsText);

    let enumeratedFunders: Array<{ name: string; category: string; region: string; searchQuery: string }> = [];
    try {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: enumerationPrompt },
          { role: 'user', content: orgContext },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 14000,
      });
      const raw = res.choices[0]?.message?.content || '{}';
      try {
        const parsed = JSON.parse(raw);
        enumeratedFunders = Array.isArray(parsed.funders) ? parsed.funders : [];
      } catch {
        // JSON truncated — recover complete funder objects from partial output
        const recovered = [...raw.matchAll(/\{\s*"name"\s*:\s*"([^"]+)"[^}]*"category"\s*:\s*"([^"]+)"[^}]*"region"\s*:\s*"([^"]+)"[^}]*"searchQuery"\s*:\s*"([^"]+)"[^}]*\}/g)]
          .map(m => ({ name: m[1], category: m[2], region: m[3], searchQuery: m[4] }));
        enumeratedFunders = recovered;
        console.warn(`[Diagnose] Enumeration JSON truncated — recovered ${recovered.length} entries`);
      }
    } catch (err) {
      console.error('[Diagnose] Enumeration failed:', err);
    }

    // ── Per-funder diagnosis ──────────────────────────────────────────────────
    const results: DiagnoseFunderResult[] = [];

    for (const expected of expectedFunders) {
      const result: DiagnoseFunderResult = {
        name: expected.name,
        url: expected.url,
        wasEnumerated: false,
        searchUrls: [],
        extractionStatus: 'not-tested',
        failureStage: 'unknown',
        diagnosis: '',
      };

      // ── A: Enumeration check ──────────────────────────────────────────────
      const enumMatch = enumeratedFunders.find(f => fuzzyMatch(f.name, expected.name));
      result.wasEnumerated = !!enumMatch;
      result.enumeratedAs = enumMatch?.name;
      result.enumeratedSearchQuery = enumMatch?.searchQuery;

      // ── B: Search ─────────────────────────────────────────────────────────
      try {
        const query = enumMatch?.searchQuery ||
          `"${expected.name}" grants apply ${market.country} ${CURRENT_YEAR}`;
        const r = await serperSearch(query.slice(0, 400), {
          num: 5,
          gl: market.id,
          excludeDomains: market.excludedDomains,
        });
        result.searchUrls = r.results.map(h => h.url);
        // Pick the first result that isn't a known-blocked domain
        result.bestSearchUrl = result.searchUrls.find(u => {
          try {
            const host = new URL(u).hostname.toLowerCase();
            return !market.excludedDomains.some(d => host === d || host.endsWith(`.${d}`));
          } catch { return false; }
        }) ?? result.searchUrls[0];
      } catch {
        result.searchUrls = [];
      }

      // ── D: Extraction test ────────────────────────────────────────────────
      const testUrl = expected.url || result.bestSearchUrl;
      if (testUrl) {
        result.testedUrl = testUrl;
        try {
          const extractResult = await tavilyClient.extract([testUrl]);
          const content = extractResult?.results?.[0]?.rawContent || '';
          if (content.length > 100) {
            result.extractionStatus = 'success';
            result.extractedSnippet = content.slice(0, 400);

            // ── E: GPT grant detection ──────────────────────────────────────
            try {
              const gptRes = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                  {
                    role: 'system',
                    content: `You are a grant researcher. Does this page contain information about a grant program that nonprofits can apply for?
Reply with JSON: { "hasGrants": true/false, "grantNames": ["name1", ...], "reason": "brief explanation" }`,
                  },
                  {
                    role: 'user',
                    content: `URL: ${testUrl}\n\nContent:\n${content.slice(0, 3000)}`,
                  },
                ],
                response_format: { type: 'json_object' },
                temperature: 0,
                max_tokens: 200,
              });
              const parsed = JSON.parse(gptRes.choices[0]?.message?.content || '{}');
              result.gptFoundGrants = parsed.hasGrants;
              result.gptGrantNames = parsed.grantNames || [];
              result.gptReason = parsed.reason;
            } catch {
              result.gptFoundGrants = undefined;
            }
          } else {
            result.extractionStatus = 'blocked';
          }
        } catch {
          result.extractionStatus = 'failed';
        }
      }

      // ── Diagnosis ─────────────────────────────────────────────────────────
      if (!result.wasEnumerated && result.searchUrls.length === 0) {
        result.failureStage = 'enumeration';
        result.diagnosis = `GPT did not enumerate this funder AND search found no results for it. This funder is invisible to the pipeline. Fix: add a funder type hint that covers this category, or list a peer funder in the "previous funders" field to trigger associative discovery.`;
      } else if (!result.wasEnumerated && result.searchUrls.length > 0) {
        result.failureStage = 'enumeration';
        result.diagnosis = `GPT did NOT enumerate this funder, but search CAN find it at ${result.bestSearchUrl}. It may be discoverable via regional/seed searches but is not guaranteed. Fix: add a funder type hint covering this category, or list a peer funder in the "previous funders" field.`;
      } else if (result.wasEnumerated && result.searchUrls.length === 0) {
        result.failureStage = 'search';
        result.diagnosis = `GPT enumerated "${result.enumeratedAs}" but search found NO results for the query: "${result.enumeratedSearchQuery}". The funder may have poor SEO or the search query may need refinement.`;
      } else if (result.wasEnumerated && result.searchUrls.length > 0 && result.extractionStatus === 'blocked') {
        result.failureStage = 'extraction';
        result.diagnosis = `Enumerated and found in search (${result.bestSearchUrl}), but extraction returned no content — the site blocks scrapers or requires JavaScript rendering. The search snippet fallback may have partially helped.`;
      } else if (result.wasEnumerated && result.searchUrls.length > 0 && result.extractionStatus === 'failed') {
        result.failureStage = 'extraction';
        result.diagnosis = `Enumerated and found in search, but extraction threw an error on ${result.testedUrl}. This may be a transient error or the URL may require authentication.`;
      } else if (result.extractionStatus === 'success' && result.gptFoundGrants === false) {
        result.failureStage = 'gpt-extraction';
        result.diagnosis = `Page extracted successfully but GPT found no grant programs in the content. Reason: "${result.gptReason}". The page may be a general homepage rather than a grants page — a more specific grants/apply URL may be needed.`;
      } else if (result.extractionStatus === 'success' && result.gptFoundGrants === true) {
        result.failureStage = 'none';
        result.diagnosis = `All pipeline steps succeeded — this funder SHOULD appear in results. Possible reasons it was missing: (1) deduplicated against another entry with the same URL, (2) scoring was very low, (3) hit rate limits in a previous run.`;
      } else {
        result.failureStage = 'unknown';
        result.diagnosis = `Unable to fully diagnose — no URL was found via search or user input to test extraction against.`;
      }

      results.push(result);
    }

    return NextResponse.json({
      market: market.displayName,
      orgContext,
      enumeratedCount: enumeratedFunders.length,
      enumeratedFunders: enumeratedFunders.map(f => `${f.name} (${f.region})`),
      results,
      durationMs: Date.now() - start,
    } as DiagnoseResponse);

  } catch (err) {
    console.error('[Diagnose] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Diagnostic failed' },
      { status: 500 }
    );
  }
}
