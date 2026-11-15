import { openai } from '@/lib/openai';
import { GrantOpportunity } from '@/lib/types';
import { getMarket, MarketConfig } from '@/lib/markets';
import { searchGrants, GrantRow } from '@/lib/db';
import { searchSchema } from '@/lib/schemas';
import { searchLimiter } from '@/lib/rate-limit';
import { authedRoute, parseBody, enforceRateLimit } from '@/lib/api';
import { SECTORS, ORG_TYPES } from '@/lib/constants';
import { computeOverallScore, clampScore } from '@/lib/scoring';

const SCORE_BATCH = 12;
const SCORE_CONCURRENCY = 35;
/** Grants scoring at or below this alignment are not returned to the client. */
const MIN_ALIGNMENT = 5;

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

function buildPrompts(market: MarketConfig, TODAY: string, orgRegions?: string[]) {
  const { country } = market;
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

EASE BASELINE BY FUNDER TYPE (start here, then adjust ±2 based on any description evidence):
- gaming-trust: 8 — online form, minimal documentation, low overhead
- council: 6 — moderate forms, some reporting requirements
- community-trust: 6 — full proposal but typically straightforward
- corporate: 7 — often streamlined online form
- iwi: 7 — typically accessible, community-focused process
- family-foundation: 5 — often relationship-based, process may be opaque
- government: 4 — multi-stage, extensive documentation, audit trail typically required
- sector-specific: 6 — varies by sector norms
- other: 6 — unknown, default to moderate

Scoring dimensions (0–10):
alignment — how specifically the grant's stated purpose matches the org's specific mission and funding request
  0-2 wrong form of support, wrong sector, or ineligible | 3-4 tangential overlap or purpose mismatch | 5-6 partial/indirect overlap — org could apply but grant wasn't designed for this | 7-8 grant purpose directly supports org's specific work | 9-10 designed for exactly this type of organisation and activity

ease — how easy it is to apply (higher = simpler process)
  1-2 multi-stage/site visits | 3-4 complex/extensive | 5-6 full proposal | 7-8 moderate effort | 9-10 simple online form

attainability — likelihood this org wins given competition and eligibility fit
  1-2 very competitive/national funder | 3-4 competitive | 5-6 moderate | 7-8 regional/less competitive | 9-10 strong match, few applicants

overall = (alignment × 0.5) + (attainability × 0.3) + (ease × 0.2), rounded to 1dp

DEADLINE RULE — today is ${TODAY}:
- Use the \`deadline\` field from the structured grant data if it is present and is a future date (after ${TODAY}).
- If the deadline field is absent, null, empty, or a past date, omit the deadline field from your output entirely — do not guess or invent a date.
- Most grants run on rolling or annual cycles. Absence of a deadline means rolling/open, not closed.

Each grant includes structured fields: name, funder, funderType (one of: government, council, gaming-trust, community-trust, iwi, corporate, family-foundation, sector-specific, other), type, description, eligibility (array), sectors (array), regions (array), amountMin, amountMax, deadline, url. Use ALL of these fields when scoring — they are authoritative data from the funder's own grant page.

CRITICAL: You MUST score every single grant provided. Do not skip, omit, or summarise any.

Return a JSON object with this exact structure:
{
  "orgSummary": "2-3 sentence summary of this organisation and their funding needs (first batch only, empty string for subsequent batches)",
  "grants": [
    {
      "id": "g-1",
      "amountMin": 5000, "amountMax": 50000, "deadline": "2026-09-30",
      "scores": { "alignment": 8, "ease": 6, "attainability": 6, "overall": 7.2 },
      "alignmentReason": "1-2 sentences explaining alignment with this org's specific mission and funding request",
      "applicationNotes": "1-2 sentences on application process complexity and what is required",
      "attainabilityNotes": "1-2 sentences on competition level and why this org is or isn't a strong candidate"
    }
  ]
}`;

  return { SCORING_SYSTEM_PROMPT };
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

/** Model output for one grant — everything is untrusted until coerced. */
interface ScoredGrant {
  amountMin?: unknown;
  amountMax?: unknown;
  deadline?: unknown;
  scores?: { alignment?: unknown; ease?: unknown; attainability?: unknown };
  alignmentReason?: unknown;
  applicationNotes?: unknown;
  attainabilityNotes?: unknown;
}

const text = (value: unknown, max = 2000): string =>
  typeof value === 'string' ? value.slice(0, max) : '';

const amount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

const isoDate = (value: unknown): string | undefined =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;

export const POST = authedRoute(async (req, { orgId }) => {
  await enforceRateLimit(searchLimiter, orgId);
  const body = await parseBody(req, searchSchema);

  const { website, fundingPurpose, fundingAmount } = body;
  const market = getMarket(body.market);
  // Computed per request — a module-level constant goes stale on a warm instance.
  const TODAY = new Date().toISOString().split('T')[0];

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
        const regionNames = body.regions
          .map(id => market.regions.find(r => r.id === id)?.name)
          .filter((name): name is string => !!name);
        const regionText = regionNames.length ? regionNames.join(', ') : 'Nationwide';

        const sectorLabels = body.sectors.map(id => SECTORS.find(s => s.id === id)?.label ?? id);
        const orgTypeLabel = ORG_TYPES.find(t => t.id === body.orgType)?.label ?? 'Unknown';

        const { SCORING_SYSTEM_PROMPT } = buildPrompts(market, TODAY, regionNames);

        const orgContext = `Organisation website: ${website}${body.linkedin ? `\nLinkedIn: ${body.linkedin}` : ''}
Organisation type: ${orgTypeLabel}
Operating regions: ${regionText}
Sectors: ${sectorLabels.join(', ') || 'Not specified'}
Funding purpose: ${fundingPurpose}
Amount sought: ${market.currency} ${market.currencySymbol}${fundingAmount.toLocaleString(market.locale)}${body.previousFunders ? `\nPrevious/current funders: ${body.previousFunders}` : ''}`;

        const costs = createCostTracker();

        // ── Fetch sector/region-filtered grants from DB ───────────────────────
        const allGrants = await searchGrants(body.sectors, body.regions, body.fundingAmount);
        console.log(`[GrantSearch] ${allGrants.length} grants from DB (sector-filtered)`);

        if (!allGrants.length) {
          send({ type: 'complete', grants: [], orgSummary: '', searchedAt: new Date().toISOString(), market: market.id });
          return;
        }

        // ── Scoring — score all grants directly (SQL sector filter replaces triage) ──
        send({ type: 'progress', phase: 'scoring', completed: 0, total: 1 });

        const batches: GrantRow[][] = [];
        for (let i = 0; i < allGrants.length; i += SCORE_BATCH) {
          batches.push(allGrants.slice(i, i + SCORE_BATCH));
        }

        console.log(`[GrantSearch] Scoring ${allGrants.length} grants in ${batches.length} batches of ${SCORE_BATCH} (concurrency: ${SCORE_CONCURRENCY})`);

        let scoreCompleted = 0;
        let failedBatches = 0;
        let returned = 0;
        let orgSummary = '';

        // Build structured payload for each grant (no free-text blob)
        const sanitize = (s: string) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
        const toPayload = (g: GrantRow) => {
          const p: Record<string, unknown> = {
            name: sanitize(g.name),
            funder: g.funder_name,
            funderType: g.funder_type || 'other',
            type: g.type || 'Other',
          };
          if (g.description) p.description = sanitize(g.description).slice(0, 1500);
          if (g.eligibility?.length) p.eligibility = g.eligibility;
          if (g.sectors?.length) p.sectors = g.sectors;
          if (g.regions?.length) p.regions = g.regions;
          if (g.amount_min != null) p.amountMin = g.amount_min;
          if (g.amount_max != null) p.amountMax = g.amount_max;
          if (g.deadline) p.deadline = g.deadline;
          if (g.is_recurring != null) p.isRecurring = g.is_recurring;
          if (g.round_frequency) p.roundFrequency = g.round_frequency;
          if (g.application_form_url) p.applicationFormUrl = g.application_form_url;
          p.url = g.url;
          return p;
        };

        await withConcurrency(
          batches.map((dbBatch, idx) => async () => {
            // The user navigated away — stop spending on batches nobody will see.
            if (req.signal.aborted) return null;

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
                temperature: 0,
                max_tokens: 16000,
              }, { signal: req.signal }));
              trackOpenAI(costs, res.model || 'gpt-4.1-mini', res.usage);
              const raw = res.choices[0]?.message?.content || '{}';
              const parsed: { orgSummary?: unknown; grants?: unknown } = JSON.parse(raw);
              const grantsArr: ScoredGrant[] = Array.isArray(parsed.grants) ? parsed.grants : [];

              // Capture orgSummary from first batch
              if (isFirst) orgSummary = text(parsed.orgSummary, 5000);

              // Map model scores back onto original DB data by index.
              // Never use the model's name/funder/url — only scores and reasons,
              // and only after coercing them to the expected types and ranges.
              const qualified: GrantOpportunity[] = [];
              for (let i = 0; i < Math.min(grantsArr.length, dbBatch.length); i++) {
                const scored = grantsArr[i];
                if (!scored?.scores) continue;

                const alignment = clampScore(scored.scores.alignment, 0);
                const ease = clampScore(scored.scores.ease, 5);
                const attainability = clampScore(scored.scores.attainability, 0);
                if (alignment <= MIN_ALIGNMENT) continue;

                const db = dbBatch[i];
                qualified.push({
                  id: db.id,
                  // Lengths are capped to the limits in grantObjectSchema so these
                  // grants can always be saved, shortlisted and tracked later.
                  name: db.name.slice(0, 500),
                  funder: (db.funder_name || '').slice(0, 500),
                  type: (db.type as GrantOpportunity['type']) || 'Other',
                  description: (db.description || '').slice(0, 5000),
                  amountMin: db.amount_min ?? amount(scored.amountMin),
                  amountMax: db.amount_max ?? amount(scored.amountMax),
                  deadline: isoDate(scored.deadline),
                  isRecurring: db.is_recurring ?? undefined,
                  roundFrequency: db.round_frequency ?? undefined,
                  url: db.url,
                  scores: {
                    alignment, ease, attainability,
                    overall: computeOverallScore({ alignment, ease, attainability }),
                  },
                  alignmentReason: text(scored.alignmentReason),
                  applicationNotes: text(scored.applicationNotes),
                  attainabilityNotes: text(scored.attainabilityNotes),
                });
              }

              returned += qualified.length;
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
              if (!req.signal.aborted) {
                console.error(`[GrantSearch] Score batch ${idx + 1} failed:`, err);
                failedBatches++;
              }
              scoreCompleted++;
              send({ type: 'progress', phase: 'scoring', completed: scoreCompleted, total: batches.length });
              return null;
            }
          }),
          SCORE_CONCURRENCY,
        );

        const costBreakdown = computeCost(costs);
        console.log(`[GrantSearch] Done — ${returned} grants returned, ${failedBatches}/${batches.length} batches failed (cost: $${costBreakdown.total.toFixed(4)})`);

        // Every batch failing is an outage, not "no matching grants".
        if (failedBatches === batches.length) {
          send({ type: 'error', message: 'We could not score grants right now. Please try again in a few minutes.' });
          return;
        }

        send({
          type: 'complete',
          searchedAt: new Date().toISOString(),
          market: market.id,
          // Lets the UI say "some grants could not be scored" instead of silently dropping them.
          incomplete: failedBatches > 0,
        });
      } catch (err) {
        // Log the detail; the client only gets a generic message.
        console.error('[GrantSearch] API error:', err);
        send({ type: 'error', message: 'The search could not be completed. Please try again.' });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
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
});
