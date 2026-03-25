import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { OrgInfo, GrantOpportunity } from '@/lib/types';
import { getMarket, MarketConfig } from '@/lib/markets';
import { searchGrants, GrantRow } from '@/lib/db';

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
  gpt4oMiniIn: 0.40 / 1_000_000,   // gpt-4.1-mini input
  gpt4oMiniOut: 1.60 / 1_000_000,   // gpt-4.1-mini output
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

APPLICANT TYPE CHECK (apply before scoring):
The searcher is an ORGANISATION (charity, trust, society, etc.), not an individual person. Many grants and scholarships are designed for individual applicants (e.g. personal scholarships, bursaries for students, individual development grants, awards for individual artists or researchers). If a grant's eligibility, description, or name indicates it is for individual people rather than organisations — e.g. "must be a young mum", "applicants must be enrolled in study", "individual artists", "personal development grant", "scholarship for students" — then the organisation CANNOT apply for it.
- If the grant is clearly for individuals: set alignment=0, attainability=0, ease=5, overall=0. Set alignmentReason to explain (e.g. "This grant is for individual applicants, not organisations.").
- If UNCLEAR whether it's for individuals or organisations: score normally but note the uncertainty in attainabilityNotes.

FORM-OF-SUPPORT CHECK (apply during alignment scoring):
The organisation is seeking a specific type of support (usually cash funding of a stated amount). Compare what the organisation needs against what the grant/programme actually provides:
- Cash grants/funding: direct monetary support the org can spend as needed
- In-kind donations: donated goods, equipment, or materials (not cash)
- Services/programmes: training, mentoring, capacity building, volunteer placement
- Fee waivers/discounts: reduced-cost access to products or services
If the grant provides in-kind support (e.g. donated equipment, pro-bono services, discounted software, food programmes, donated products) but the organisation is seeking cash funding, these are MISALIGNED even if the topic area overlaps. Reduce alignment to 3-4 maximum (partial overlap at best). The org cannot use donated goods to pay for contractors, wages, or other cash expenses.
Similarly, if the grant is for research, scholarships, fellowships, or academic study but the org seeks operational/project funding, this is a PURPOSE MISMATCH — cap alignment at 4.
Conversely, if the org specifically seeks in-kind support and the grant provides it, score normally.

PURPOSE-ALIGNMENT STRICTNESS (critical — apply rigorously):
Alignment measures how specifically the grant's PURPOSE matches the org's SPECIFIC MISSION AND FUNDING REQUEST — not merely whether the org is eligible to apply.
- A grant that is "open to all charities" or funds "general community purposes" does NOT automatically score high. Being eligible ≠ being aligned.
- Do NOT inflate alignment because the grant provides cash funding. Nearly all grants provide cash — this is not a distinguishing factor.
- Generic/broad grants (e.g. "community development", "charitable purposes", gaming trust general grants) with no stated focus matching the org's specific work should score alignment 4-6 at most.
- A score of 7+ requires the grant's STATED PURPOSE to directly relate to the org's specific area of work — not just sector overlap.
- A score of 9-10 means the grant was essentially designed for organisations doing exactly this work.

LOW-INFORMATION SCORING:
If a grant has no description, no stated sectors, and no eligibility criteria, do NOT assume strong alignment. Score conservatively:
- With no information about grant purpose: alignment 4-5 maximum (possible but unverified match)
- Only increase above 5 if funder name or other context provides clear evidence of relevance.

REASONING-SCORE CONSISTENCY (mandatory):
Your alignmentReason MUST be consistent with your alignment score. If your reasoning identifies a mismatch or limitation (e.g. "though funding is research-focused rather than direct funding", "but primarily targets schools", "however the grant is for sports"), the alignment score MUST reflect that mismatch:
- If you write "though", "but", "however", or "although" to qualify alignment, the score should be 5 or below — not 7.
- If the grant's primary purpose differs from the org's specific need, even with topic overlap, score 4-5.
- Only score 6+ if alignment is genuine and unqualified.

Scoring dimensions (0–10):
alignment — how specifically the grant's stated purpose matches the org's specific mission and funding request
  0-2 wrong form of support, wrong sector, or ineligible | 3-4 tangential overlap or purpose mismatch | 5-6 partial/indirect overlap — org could apply but grant wasn't designed for this | 7-8 grant purpose directly supports org's specific work | 9-10 designed for exactly this type of organisation and activity

ease — how easy it is to apply (higher = simpler process)
  1-2 multi-stage/site visits | 3-4 complex/extensive | 5-6 full proposal | 7-8 moderate effort | 9-10 simple online form

attainability — likelihood this org wins given competition and eligibility fit
  1-2 very competitive/national funder | 3-4 competitive | 5-6 moderate | 7-8 regional/less competitive | 9-10 strong match, few applicants

overall = (alignment × 0.5) + (attainability × 0.3) + (ease × 0.2), rounded to 1dp

DEADLINE RULE — today is ${TODAY}:
- Extract a deadline ONLY if the pageContent contains a specific future date explicitly stated as a closing or application date.
- The date must be after ${TODAY}. If the date is in the past, or if no date is stated, omit the deadline field entirely — do not guess.
- Most grants run on rolling or annual cycles. Absence of a deadline means rolling/open, not closed.

Each grant includes structured fields: name, funder, funderType (one of: government, council, gaming-trust, community-trust, iwi, corporate, family-foundation, sector-specific, other), type, description, eligibility (array), sectors (array), regions (array), amountMin, amountMax, deadline, url. Use ALL of these fields when scoring — they are authoritative data from the funder's own grant page.

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

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Parse and validate before starting the stream
  let body: OrgInfo;
  try {
    body = await req.json() as OrgInfo;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { website, fundingPurpose, fundingAmount, market: marketId } = body;
  if (!website || !fundingPurpose || !fundingAmount) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const market = getMarket(marketId || 'nz');

  // Return a streaming SSE response — keeps the connection alive on Vercel
  // (streaming responses get up to 300s vs 60s for buffered responses)
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Send initial comment to flush proxy/browser buffers
      controller.enqueue(encoder.encode(': connected\n\n'));

      function send(event: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Client disconnected
        }
      }

      try {
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

        const { SCORING_SYSTEM_PROMPT } = buildPrompts(market, regionNames);

        const orgContext = `Organisation website: ${website}${body.linkedin ? `\nLinkedIn: ${body.linkedin}` : ''}
Organisation type: ${orgTypeLabel}
Operating regions: ${regionText}
Sectors: ${sectorLabels.join(', ') || 'Not specified'}
Funding purpose: ${fundingPurpose}
Amount sought: ${market.currency} ${market.currencySymbol}${fundingAmount.toLocaleString(market.locale)}${body.previousFunders ? `\nPrevious/current funders: ${body.previousFunders}` : ''}`;

        // ─── Two-pass triage + score from grants DB ──────────────────────────
        const costs = createCostTracker();

        // ── Fetch sector-filtered grants from DB ──────────────────────────────
        const allGrants = await searchGrants(body.sectors || [], body.regions || []);
        console.log(`[GrantSearch] ${allGrants.length} grants from DB (sector-filtered)`);

        if (!allGrants.length) {
          send({ type: 'complete', grants: [], orgSummary: '', searchedAt: new Date().toISOString(), market: market.id });
          controller.close();
          return;
        }

        // ── Scoring — score all grants directly (SQL sector filter replaces triage) ──
        send({ type: 'progress', phase: 'scoring', completed: 0, total: 1 });

        const SCORE_BATCH = 12;
        const batches: GrantRow[][] = [];
        for (let i = 0; i < allGrants.length; i += SCORE_BATCH) {
          batches.push(allGrants.slice(i, i + SCORE_BATCH));
        }

        console.log(`[GrantSearch] Scoring ${allGrants.length} grants in ${batches.length} batches of ${SCORE_BATCH} (concurrency: 35)`);

        let scoreCompleted = 0;
        let orgSummary = '';
        const allScoredGrants: GrantOpportunity[] = [];

        // Build structured payload for each grant (no free-text blob)
        const toPayload = (g: GrantRow) => {
          const p: Record<string, unknown> = {
            name: g.name,
            funder: g.funder_name,
            funderType: g.funder_type || 'other',
            type: g.type || 'Other',
          };
          if (g.description) p.description = g.description.slice(0, 1500);
          if (g.eligibility?.length) p.eligibility = g.eligibility;
          if (g.sectors?.length) p.sectors = g.sectors;
          if (g.regions?.length) p.regions = g.regions;
          if (g.amount_min != null) p.amountMin = g.amount_min;
          if (g.amount_max != null) p.amountMax = g.amount_max;
          if (g.deadline) p.deadline = g.deadline;
          if (g.application_form_url) p.applicationFormUrl = g.application_form_url;
          p.url = g.url;
          return p;
        };

        await withConcurrency(
          batches.map((dbBatch, idx) => async () => {
            const isFirst = idx === 0;
            const grantsPayload = dbBatch.map(toPayload);
            try {
              const res = await withRetry(() => openai.chat.completions.create({
                model: 'gpt-4.1-mini',
                messages: [
                  { role: 'system', content: SCORING_SYSTEM_PROMPT },
                  {
                    role: 'user',
                    content: `${orgContext}\n\nToday: ${TODAY}\n${isFirst ? '' : 'Set orgSummary to empty string.\n'}\nScore ALL ${dbBatch.length} grants. Return exactly ${dbBatch.length} entries in the grants array in the SAME ORDER as provided.\n\n${JSON.stringify(grantsPayload, null, 2)}`,
                  },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.1,
                max_tokens: 16000,
              }));
              trackOpenAI(costs, res.model || 'gpt-4.1-mini', res.usage);
              const raw = res.choices[0]?.message?.content || '{}';
              const parsed = JSON.parse(raw);
              const grantsArr: GrantOpportunity[] = parsed.grants || [];

              // Capture orgSummary from first batch
              if (isFirst && parsed.orgSummary) {
                orgSummary = parsed.orgSummary;
              }

              // Map model scores back onto original DB data by index
              // Never use model's name/funder/url — only scores and reasons
              const qualified: GrantOpportunity[] = [];
              for (let i = 0; i < Math.min(grantsArr.length, dbBatch.length); i++) {
                const scored = grantsArr[i];
                if (!scored?.scores) continue;

                const { alignment = 0, ease = 5, attainability = 0 } = scored.scores;
                const overall = scored.scores.overall || Math.round(((alignment * 0.5) + (attainability * 0.3) + (ease * 0.2)) * 10) / 10;

                if (alignment <= 5) continue;

                const db = dbBatch[i];
                qualified.push({
                  id: db.id,
                  name: db.name,
                  funder: db.funder_name,
                  type: (db.type as GrantOpportunity['type']) || 'Other',
                  description: scored.description || db.description || '',
                  amountMin: db.amount_min ?? scored.amountMin,
                  amountMax: db.amount_max ?? scored.amountMax,
                  deadline: scored.deadline,
                  url: db.url,
                  scores: { alignment, ease, attainability, overall },
                  alignmentReason: scored.alignmentReason || '',
                  applicationNotes: scored.applicationNotes || '',
                  attainabilityNotes: scored.attainabilityNotes || '',
                });
              }

              allScoredGrants.push(...qualified);
              scoreCompleted++;

              send({
                type: 'grants',
                grants: qualified,
                orgSummary: isFirst ? orgSummary : '',
                completed: scoreCompleted,
                total: batches.length,
              });

              return null;
            } catch (err) {
              console.error(`[GrantSearch] Score batch ${idx + 1} failed:`, err);
              scoreCompleted++;
              send({ type: 'progress', phase: 'scoring', completed: scoreCompleted, total: batches.length });
              return null;
            }
          }),
          35,
        );

        const costBreakdown = computeCost(costs);
        console.log(`[GrantSearch] Done — ${allScoredGrants.length} grants returned (cost: $${costBreakdown.total.toFixed(4)})`);

        send({
          type: 'complete',
          searchedAt: new Date().toISOString(),
          market: market.id,
        });
      } catch (err) {
        console.error('[GrantSearch] API error:', err);
        send({ type: 'error', message: err instanceof Error ? err.message : 'An unexpected error occurred' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
