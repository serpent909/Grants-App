import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { OrgInfo, GrantOpportunity, SearchResult } from '@/lib/types';
import { getMarket, MarketConfig } from '@/lib/markets';
import { generateGrantId, searchGrants, GrantRow } from '@/lib/db';

const TODAY = new Date().toISOString().split('T')[0];

// ─── Cost tracking ───────────────────────────────────────────────────────────

interface CostTracker {
  gpt4oMiniIn: number;
  gpt4oMiniOut: number;
}

function createCostTracker(): CostTracker {
  return { gpt4oMiniIn: 0, gpt4oMiniOut: 0 };
}

function trackOpenAI(costs: CostTracker, _model: string, usage?: { prompt_tokens?: number; completion_tokens?: number }) {
  if (!usage) return;
  costs.gpt4oMiniIn += usage.prompt_tokens ?? 0;
  costs.gpt4oMiniOut += usage.completion_tokens ?? 0;
}

const PRICING = {
  gpt4oMiniIn: 0.15 / 1_000_000,
  gpt4oMiniOut: 0.60 / 1_000_000,
};

function computeCost(costs: CostTracker) {
  const total = costs.gpt4oMiniIn * PRICING.gpt4oMiniIn + costs.gpt4oMiniOut * PRICING.gpt4oMiniOut;
  return { total };
}

// ─── Prompt factory ───────────────────────────────────────────────────────────

function buildPrompts(market: MarketConfig, orgRegions?: string[]) {
  const { country, currency } = market;
  const regionText = orgRegions?.length ? orgRegions.join(', ') : '';

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

  return { SCORING_SYSTEM_PROMPT, RELEVANCE_TRIAGE_PROMPT };
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

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as OrgInfo;
    const { website, fundingPurpose, fundingAmount, market: marketId } = body;
    if (!website || !fundingPurpose || !fundingAmount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const market = getMarket(marketId || 'nz');

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
        'rural': 'Rural Communities', 'economic-development': 'Economic Development',
        'animal-welfare': 'Animal Welfare',
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

    const { SCORING_SYSTEM_PROMPT, RELEVANCE_TRIAGE_PROMPT } = buildPrompts(market, regionNames);

    const orgContext = `Organisation website: ${website}${body.linkedin ? `\nLinkedIn: ${body.linkedin}` : ''}
Organisation type: ${orgTypeLabel}
Operating regions: ${regionText}
Sectors: ${sectorLabels.join(', ') || 'Not specified'}
Funding purpose: ${fundingPurpose}
Amount sought: ${market.currency} ${market.currencySymbol}${fundingAmount.toLocaleString(market.locale)}${body.previousFunders ? `\nPrevious/current funders: ${body.previousFunders}` : ''}`;

    // ─── Two-pass triage + score from grants DB ──────────────────────────────
    const costs = createCostTracker();

    // ── Pass 1: Triage — cheap binary relevance filter over all DB grants ──
    const allGrants = await searchGrants(body.sectors || [], body.regions || []);
    console.log(`[GrantSearch] Pass 1: triaging ${allGrants.length} grants`);

    const TRIAGE_BATCH = 100;
    const triageBatches: Array<{ batchGrants: GrantRow[]; offset: number }> = [];
    for (let i = 0; i < allGrants.length; i += TRIAGE_BATCH) {
      triageBatches.push({ batchGrants: allGrants.slice(i, i + TRIAGE_BATCH), offset: i });
    }

    const triageDecisions = await withConcurrency(
      triageBatches.map(({ batchGrants, offset }) => async () => {
        const payload = batchGrants.map((g, i) => ({
          index: i,
          name: g.name,
          funder: g.funder_name,
          type: g.type,
          description: (g.description || '').slice(0, 150),
          sectors: g.sectors,
          regions: g.regions,
          amountMin: g.amount_min,
          amountMax: g.amount_max,
        }));
        try {
          const res = await withRetry(() => openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: RELEVANCE_TRIAGE_PROMPT },
              { role: 'user', content: `${orgContext}\n\nToday: ${TODAY}\n\nClassify these ${batchGrants.length} grants:\n\n${JSON.stringify(payload)}` },
            ],
            response_format: { type: 'json_object' },
            temperature: 0,
            max_tokens: 2000,
          }));
          trackOpenAI(costs, 'gpt-4o-mini', res.usage);
          const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
          const decisions = (parsed.decisions || []) as Array<{ index: number; decision: string }>;
          return decisions.map(d => ({ globalIndex: d.index + offset, decision: d.decision }));
        } catch {
          // On error default all to RELEVANT — never drop grants due to a failed call
          return batchGrants.map((_, i) => ({ globalIndex: i + offset, decision: 'RELEVANT' }));
        }
      }),
      15,
    );

    const skippedIndices = new Set<number>();
    for (const decisions of triageDecisions) {
      for (const d of decisions) {
        if (d.decision === 'SKIP') skippedIndices.add(d.globalIndex);
      }
    }
    const relevantGrants = allGrants.filter((_, i) => !skippedIndices.has(i));
    console.log(`[GrantSearch] Triage: ${allGrants.length} → ${relevantGrants.length} relevant (${skippedIndices.size} skipped)`);

    if (!relevantGrants.length) {
      return NextResponse.json({ grants: [], orgSummary: '', searchedAt: new Date().toISOString(), market: market.id });
    }

    // ── Pass 2: Full scoring of relevant grants only ──────────────────────
    const toPageContent = (g: GrantRow): string => {
      const parts: string[] = [];
      if (g.description) parts.push(g.description);
      if (g.eligibility?.length) parts.push('Eligibility: ' + g.eligibility.join('; '));
      if (g.sectors?.length) parts.push('Sectors: ' + g.sectors.join(', '));
      if (g.regions?.length) parts.push('Regions: ' + g.regions.join(', '));
      if (g.amount_min != null || g.amount_max != null) {
        const lo = g.amount_min != null ? `${market.currencySymbol}${g.amount_min.toLocaleString()}` : '';
        const hi = g.amount_max != null ? `${market.currencySymbol}${g.amount_max.toLocaleString()}` : '';
        parts.push('Grant amount: ' + (lo && hi ? `${lo}–${hi}` : lo || hi));
      }
      if (g.deadline) parts.push('Deadline: ' + g.deadline);
      if (g.application_form_url) parts.push('Application form: ' + g.application_form_url);
      return parts.join('\n');
    };

    const discoveredFromDb: DiscoveredGrant[] = relevantGrants.map(g => ({
      name: g.name,
      funder: g.funder_name,
      type: (g.type as DiscoveredGrant['type']) || 'grant',
      description: g.description || '',
      amountMin: g.amount_min ?? undefined,
      amountMax: g.amount_max ?? undefined,
      url: g.url,
      pageContent: toPageContent(g),
    }));

    const SCORE_BATCH = 25;
    const scoreBatches: DiscoveredGrant[][] = [];
    for (let i = 0; i < discoveredFromDb.length; i += SCORE_BATCH) {
      scoreBatches.push(discoveredFromDb.slice(i, i + SCORE_BATCH));
    }

    console.log(`[GrantSearch] Pass 2: scoring ${discoveredFromDb.length} grants in ${scoreBatches.length} batches`);

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
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: SCORING_SYSTEM_PROMPT },
              {
                role: 'user',
                content: `${orgContext}\n\nToday: ${TODAY}\n${isFirst ? '' : 'Set orgSummary to empty string.\n'}\nScore ALL ${batch.length} grants. Return exactly ${batch.length} entries in the grants array.\n\n${JSON.stringify(grantsPayload, null, 2)}`,
              },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 16000,
          }));
          trackOpenAI(costs, res.model || 'gpt-4o-mini', res.usage);
          const raw = res.choices[0]?.message?.content || '{}';
          const parsed = JSON.parse(raw);
          const grantsArr: GrantOpportunity[] = parsed.grants || [];
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
      15,
    );

    const orgSummary = (scoreResults[0] as { orgSummary?: string } | null)?.orgSummary || '';
    const grants = scoreResults
      .flatMap(r => r?.grants || [])
      .filter(g => (g.scores?.alignment ?? 0) >= 5)
      .map(g => ({ ...g, id: generateGrantId(g.funder, g.name, g.url) }));

    const costBreakdown = computeCost(costs);
    console.log(`[GrantSearch] Done — ${grants.length} grants returned (cost: $${costBreakdown.total.toFixed(4)})`);

    return NextResponse.json({
      grants,
      orgSummary,
      searchedAt: new Date().toISOString(),
      market: market.id,
      inputs: body,
    } satisfies SearchResult);

  } catch (err) {
    console.error('[GrantSearch] API error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
