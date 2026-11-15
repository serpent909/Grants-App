import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { tavilyClient } from '@/lib/tavily';
import { serperSearch } from '@/lib/serper';
import { DeepSearchResult } from '@/lib/types';
import { getMarket } from '@/lib/markets';
import { getPool, ensureStorageTables, getGrantIdentity, writeDeepSearchUpdates } from '@/lib/db';
import { findGrantLinksFromHtml } from '@/lib/nav-links';
import { deepSearchRequestSchema, deepSearchModelOutputSchema } from '@/lib/schemas';
import { deepSearchLimiter } from '@/lib/rate-limit';
import { authedRoute, parseBody, enforceRateLimit, ApiError } from '@/lib/api';
import { isSafeUrl, safeFetch } from '@/lib/url-safety';
import { computeOverallScore } from '@/lib/scoring';

// ─── Cost tracking ───────────────────────────────────────────────────────────

interface CostTracker {
  gpt4oIn: number;
  gpt4oOut: number;
  tavilyUrls: number;
  serperQueries: number;
}

function createCostTracker(): CostTracker {
  return { gpt4oIn: 0, gpt4oOut: 0, tavilyUrls: 0, serperQueries: 0 };
}

const PRICING = {
  gpt4oIn: 2.50 / 1_000_000,
  gpt4oOut: 10.00 / 1_000_000,
  tavilyPerUrl: 0.008,
  serperPerQuery: 0.001,
};

function computeCost(c: CostTracker) {
  const gpt = c.gpt4oIn * PRICING.gpt4oIn + c.gpt4oOut * PRICING.gpt4oOut;
  const tavily = c.tavilyUrls * PRICING.tavilyPerUrl;
  const serper = c.serperQueries * PRICING.serperPerQuery;
  return { gpt, tavily, serper, total: gpt + tavily + serper };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
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
        console.warn(`[DeepSearch] Rate limited — waiting ${waitMs}ms (retry ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, waitMs));
        attempt++;
      } else {
        throw err;
      }
    }
  }
}

const NON_GRANT_PATH_PATTERNS = [
  /\/press-release/i, /\/media-release/i, /\/news-release/i, /\/blog\//i,
  /\/login\b/i, /\/signin\b/i, /\/register\b/i, /\/signup\b/i,
  /\/privacy-policy/i, /\/terms-of-use/i, /\/cookie-policy/i,
  /\/careers\b/i, /\/jobs\b/i, /\/vacancies\b/i,
  /\/sitemap/i, /\/feed\/?$/i, /\/rss\b/i, /\/wp-json\//i,
  /\/annual-reports?\b/i, /\/shop\//i, /\/cart\b/i, /\/donate\b/i,
];

function isGrantPage(url: string, excludedDomains: string[]): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (excludedDomains.some(d => host.endsWith(d) || host === d)) return false;
    if (NON_GRANT_PATH_PATTERNS.some(p => p.test(path))) return false;
    return true;
  } catch { return true; }
}

// ─── Main handler ────────────────────────────────────────────────────────────

/** Only ISO calendar dates are written back to the shared grants table. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const POST = authedRoute(async (req, { orgId }) => {
  await enforceRateLimit(deepSearchLimiter, orgId);
  await ensureStorageTables();

  const costs = createCostTracker();
  const t0 = Date.now();
  // Computed per request — module-level constants go stale on a warm instance.
  const TODAY = new Date().toISOString().split('T')[0];
  const CURRENT_YEAR = new Date().getFullYear();

  try {
    const body = await parseBody(req, deepSearchRequestSchema);
    const { orgContext, market: marketId } = body;

    // The grants table is shared by every tenant, and this route writes what it
    // learns back into it. So the grant's identity (name, funder and — above all —
    // the URL we research) comes from the database, never from the request.
    // Without this, a caller could point the research at a page they control and
    // have its contents (e.g. a fake application form link) saved for all orgs.
    const known = await getGrantIdentity(body.grant.id);
    const grant = known
      ? {
          ...body.grant,
          name: known.name,
          funder: known.funder_name,
          url: known.url,
          description: known.description || body.grant.description,
        }
      : body.grant;
    // Grants that no longer exist in the table (old saved-search snapshots) can
    // still be researched for this org, but nothing is written back.
    const canWriteBack = known !== null;

    if (!isSafeUrl(grant.url)) {
      throw new ApiError(400, 'This grant does not have a valid public web page to research.');
    }

    const market = getMarket(marketId || 'nz');
    let grantDomain = '';
    try { grantDomain = new URL(grant.url).hostname.replace(/^www\./, ''); } catch {}

    console.log(`[DeepSearch] Starting deep search for "${grant.name}" by ${grant.funder}`);

    // ────────────────────────────────────────────────────────────────────────
    // Phase 1: Targeted Serper searches (6 queries in parallel)
    // ────────────────────────────────────────────────────────────────────────

    const queries = [
      `"${grant.funder}" "${grant.name}" application form apply ${CURRENT_YEAR}`,
      `"${grant.funder}" "${grant.name}" guidelines criteria eligibility`,
      `"${grant.funder}" "${grant.name}" application deadline dates ${CURRENT_YEAR}`,
      `"${grant.funder}" grants recipients funded ${CURRENT_YEAR - 1}`,
      `"${grant.funder}" "${grant.name}" checklist requirements documents`,
      ...(grantDomain ? [
        `site:${grantDomain} apply application form grant`,
        `site:${grantDomain} grants funding deadline ${CURRENT_YEAR}`,
      ] : []),
    ];

    // Run Serper queries and nav link discovery in parallel (nav links are free)
    const homepageUrl = grantDomain ? `https://${grantDomain}` : null;

    const [searchResults, navLinks] = await Promise.all([
      // Serper queries
      Promise.all(
        queries.map(async q => {
          costs.serperQueries++;
          try {
            const res = await serperSearch(q, {
              num: 10,
              gl: market.id,
              excludeDomains: market.excludedDomains,
            });
            return res.results;
          } catch (err) {
            console.warn(`[DeepSearch] Serper query failed: ${q}`, err);
            return [];
          }
        }),
      ),
      // Nav link discovery from funder homepage (free HTML fetch)
      homepageUrl ? findGrantLinksFromHtml(homepageUrl, safeFetch) : Promise.resolve([]),
    ]);

    // Collect unique URLs, prioritising the grant's own domain
    const seen = new Set<string>();
    const snippetMap = new Map<string, string>();
    const sameDomainUrls: string[] = [];
    const otherUrls: string[] = [];

    // Always include the grant's original URL first
    seen.add(normaliseUrl(grant.url));

    // Add nav-discovered URLs first (high-value same-domain pages) — skip unsafe URLs
    for (const link of navLinks) {
      if (!isSafeUrl(link.url)) continue;
      const norm = normaliseUrl(link.url);
      if (seen.has(norm)) continue;
      seen.add(norm);
      try {
        const host = new URL(link.url).hostname.replace(/^www\./, '');
        if (grantDomain && host.includes(grantDomain)) {
          sameDomainUrls.push(link.url);
        }
      } catch { /* skip invalid URLs */ }
    }

    if (navLinks.length > 0) {
      console.log(`[DeepSearch] Nav links discovered: ${navLinks.length} (${sameDomainUrls.length} same-domain)`);
    }

    // Add Serper-discovered URLs
    for (const results of searchResults) {
      for (const r of results) {
        const norm = normaliseUrl(r.url);
        if (seen.has(norm)) continue;
        seen.add(norm);
        if (!isSafeUrl(r.url)) continue;
        if (!isGrantPage(r.url, market.excludedDomains)) continue;

        snippetMap.set(norm, r.content);
        try {
          const host = new URL(r.url).hostname.replace(/^www\./, '');
          if (grantDomain && host.includes(grantDomain)) {
            sameDomainUrls.push(r.url);
          } else {
            otherUrls.push(r.url);
          }
        } catch {
          otherUrls.push(r.url);
        }
      }
    }

    // Take up to 5 same-domain + 4 other-domain = 9 discovered, + 1 original = 10 max
    const urlsToExtract = [
      grant.url,
      ...sameDomainUrls.slice(0, 5),
      ...otherUrls.slice(0, 4),
    ].slice(0, 10);

    console.log(`[DeepSearch] Phase 1 complete: ${queries.length} Serper queries + nav links → ${urlsToExtract.length} URLs to extract`);

    // ────────────────────────────────────────────────────────────────────────
    // Phase 2: Tavily content extraction
    // ────────────────────────────────────────────────────────────────────────

    interface ExtractedPage { url: string; content: string }
    const pages: ExtractedPage[] = [];

    costs.tavilyUrls += urlsToExtract.length;

    try {
      const result = await tavilyClient.extract(urlsToExtract);
      if (result?.results) {
        for (const r of result.results) {
          if (r?.rawContent && r?.url) {
            // Give the primary grant URL more content allowance
            const isPrimary = normaliseUrl(r.url) === normaliseUrl(grant.url);
            const limit = isPrimary ? 15000 : 8000;
            pages.push({ url: r.url, content: r.rawContent.slice(0, limit) });
          }
        }
      }
    } catch (err) {
      console.warn('[DeepSearch] Tavily extraction error:', err);
    }

    // Fallback: for URLs that weren't extracted, use search snippets
    const extractedNorms = new Set(pages.map(p => normaliseUrl(p.url)));
    for (const url of urlsToExtract) {
      const norm = normaliseUrl(url);
      if (extractedNorms.has(norm)) continue;
      const snippet = snippetMap.get(norm);
      if (snippet && snippet.length > 100) {
        pages.push({ url, content: snippet });
      }
    }

    console.log(`[DeepSearch] Phase 2 complete: ${pages.length} pages extracted`);

    if (pages.length === 0) {
      throw new ApiError(422, 'Could not extract any content from the grant page or related pages.');
    }

    // ────────────────────────────────────────────────────────────────────────
    // Phase 3: GPT-4o structured analysis
    // ────────────────────────────────────────────────────────────────────────

    const pagesText = pages
      .map((p, i) => {
        const isPrimary = normaliseUrl(p.url) === normaliseUrl(grant.url);
        const tag = isPrimary ? ' [PRIMARY GRANT PAGE]' : '';
        return `=== PAGE ${i + 1}${tag} ===\nURL: ${p.url}\n\n${p.content}`;
      })
      .join('\n\n');

    const orgContextText = [
      `Organisation: ${orgContext.website}`,
      orgContext.fundingPurpose ? `Funding purpose: ${orgContext.fundingPurpose}` : '',
      orgContext.fundingAmount ? `Amount sought: ${market.currencySymbol}${orgContext.fundingAmount.toLocaleString()}` : '',
      orgContext.sectors?.length ? `Sectors: ${orgContext.sectors.join(', ')}` : '',
      orgContext.regions?.length ? `Regions: ${orgContext.regions.join(', ')}` : '',
      orgContext.orgType ? `Organisation type: ${orgContext.orgType}` : '',
    ].filter(Boolean).join('\n');

    const systemPrompt = `You are an expert ${market.country} grant research analyst performing a DEEP ANALYSIS of a specific grant program.

You have been given web page content extracted from the funder's website and related pages. Your task is to extract precise, actionable information about this grant program.

GRANT BEING ANALYSED:
- Name: ${grant.name}
- Funder: ${grant.funder}
- URL: ${grant.url}
- Initial description: ${grant.description}

CURRENT SCORES (from initial search):
- Alignment: ${grant.scores.alignment}/10 — ${grant.alignmentReason}
- Ease: ${grant.scores.ease}/10 — ${grant.applicationNotes}
- Attainability: ${grant.scores.attainability}/10 — ${grant.attainabilityNotes}

Today's date: ${TODAY}

Analyse ALL the provided page content carefully and return a JSON object with this exact structure:

{
  "amountMin": <number or null — precise minimum grant amount in ${market.currency} if stated>,
  "amountMax": <number or null — precise maximum grant amount in ${market.currency} if stated>,
  "amountNotes": "<any additional context about funding amounts, average grant sizes, multi-year availability>",

  "applicationOpenDate": "<ISO date string or null — when applications next open>",
  "applicationCloseDate": "<ISO date string or null — the NEXT upcoming close date after ${TODAY}>",
  "dateNotes": "<context about timing — annual rounds, rolling applications, frequency, specific rounds, etc.>",

  "checklist": [
    {
      "item": "<short name e.g. 'Project budget'>",
      "description": "<what exactly is required, with as much specificity as found in the source material>",
      "required": <true if explicitly mandatory, false if optional or recommended>
    }
  ],

  "applicationFormUrl": "<direct URL to the application form/portal if found, or null>",
  "applicationFormType": "<'online' | 'pdf' | 'word' | 'unknown'>",
  "applicationFormNotes": "<how to access the form — e.g. 'Must create account on SmartyGrants portal first'>",

  "eligibilityCriteria": ["<each distinct eligibility criterion as a separate string>"],

  "scores": {
    "alignment": <recalibrated 0-10>,
    "ease": <recalibrated 0-10>,
    "attainability": <recalibrated 0-10>,
    "overall": <(alignment * 0.5) + (attainability * 0.3) + (ease * 0.2), rounded to 1dp>
  },
  "scoreChanges": {
    "alignment": { "old": ${grant.scores.alignment}, "new": <new score>, "reason": "<why it changed or stayed the same>" },
    "ease": { "old": ${grant.scores.ease}, "new": <new score>, "reason": "<why it changed or stayed the same>" },
    "attainability": { "old": ${grant.scores.attainability}, "new": <new score>, "reason": "<why it changed or stayed the same>" }
  },

  "additionalInfo": "<any other useful information found: key dates, special requirements, tips, common mistakes, etc.>",
  "keyContacts": "<name, email, phone of the grants manager/administrator if found on any page>",
  "pastRecipientNotes": "<what we learned about past recipients — number of grants awarded, typical organisations funded, success rate if available>",

  "sourcesUsed": [
    { "url": "<URL that provided useful information>", "title": "<brief description of what this page contained>" }
  ]
}

SCORING RECALIBRATION RULES:
- You now have MORE information than the initial scorer had. Use it to AGGRESSIVELY refine scores based on what you actually found.
- If the page content confirms the initial assessment, keep the same score and note "Confirmed by deep search".
- If you found new information that changes the assessment, adjust the score and explain what changed.
- Ease: lower the score if the application process is more complex than initially estimated (e.g. multi-stage, site visits, extensive attachments). Raise it if the process is simpler.
- Attainability: adjust based on past recipient information, competition level, and eligibility fit.
- Alignment: adjust based on detailed eligibility criteria and whether the organisation actually qualifies.

CRITICAL DISQUALIFICATION CHECKS (apply these before confirming any score — drop to 0 if triggered):
1. INDIVIDUAL vs ORGANISATION: The searcher is an ORGANISATION. If the grant's eligibility criteria indicate it is for individual people (e.g. "must be a young mum", "applicants must be students", "individual artists", scholarships, bursaries, personal development grants), the organisation CANNOT apply. Set alignment=0, attainability=0, overall=0. Explain in scoreChanges.
2. FORM OF SUPPORT MISMATCH: If the grant provides in-kind support (donated goods, equipment, food programmes, pro-bono services, software discounts) but the org seeks cash funding, set alignment to 3-4 maximum.
3. PURPOSE MISMATCH: If the grant is for research, scholarships, fellowships, or academic study but the org seeks operational/project funding, set alignment to 3-4 maximum.
4. REASONING-SCORE CONSISTENCY: If your reason for a score includes qualifiers like "though", "but", "however" indicating a mismatch, the score MUST reflect that — do not write a caveat and still give 7+.

CHECKLIST RULES:
- Extract EVERY requirement mentioned anywhere in the source material.
- Include both documents/attachments AND information/steps needed.
- Common items to look for: project description, budget, financial statements, letters of support, governance documents, quotes/tenders, timeline, outcomes framework, annual report, proof of legal status, references.
- Order from most to least important.

DATE & DEADLINE RULES (CRITICAL — follow carefully):
- Today is ${TODAY}. You must determine the NEXT upcoming deadline.
- Many grants have RECURRING deadlines (annual, bi-annual, quarterly, rolling). Look for patterns like "31 March and 30 September each year", "annually in June", "quarterly", "applications accepted year-round", etc.
- If a grant has recurring rounds, calculate the NEXT future deadline date after ${TODAY}. For example, if today is 2026-03-18 and the grant closes "31 March and 30 September each year", the next deadline is 2026-03-31.
- If the page mentions past-year dates (e.g. "2024 round closes 30 September 2024"), check whether this is a recurring grant. If so, project forward to ${CURRENT_YEAR} or ${CURRENT_YEAR + 1} as appropriate.
- Only set applicationCloseDate to null if there is genuinely no deadline information, or if the grant is confirmed to be permanently closed/discontinued.
- In dateNotes, always describe the recurrence pattern (e.g. "Twice annually: 31 March and 30 September"), even if you have already set a specific date.
- If the grant URL is a PDF application form for ${CURRENT_YEAR} or ${CURRENT_YEAR + 1}, that strongly suggests the grant is currently open.

PDF & APPLICATION FORM RULES:
- Some URLs may point to PDF or Word application forms. These contain critical requirement details — extract all fields, questions, and required attachments.
- If the primary grant URL is a PDF download, look for the grant information page on the same domain in the other extracted pages.

Be thorough but factual — only include information that is directly supported by the extracted content. If information is not found in the source material, set the field to null or an empty array rather than guessing.`;

    const userPrompt = `${orgContextText}\n\nExtracted page content:\n\n${pagesText}`;

    const completion = await withRetry(() =>
      openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0,
        max_tokens: 8000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    );

    const usage = completion.usage;
    costs.gpt4oIn += usage?.prompt_tokens ?? 0;
    costs.gpt4oOut += usage?.completion_tokens ?? 0;

    const raw = completion.choices[0]?.message?.content || '{}';

    // Treat the model's JSON as untrusted input: coerce every field to the
    // expected type/length, drop non-http links, clamp scores to 0–10.
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(stripFences(raw));
    } catch {
      throw new ApiError(502, 'The research could not be completed. Please try again.');
    }
    const parsed = deepSearchModelOutputSchema.parse(rawJson);

    // Recalculate overall to prevent model arithmetic errors
    const scores = parsed.scores
      ? { ...parsed.scores, overall: computeOverallScore(parsed.scores) }
      : grant.scores;

    const unchanged = (value: number) => ({ old: value, new: value, reason: 'No change' });

    // Assemble the final result
    const deepResult: DeepSearchResult = {
      grantId: grant.id,
      grantName: grant.name,
      funder: grant.funder,
      grantUrl: grant.url,
      searchedAt: new Date().toISOString(),

      amountMin: parsed.amountMin,
      amountMax: parsed.amountMax,
      amountNotes: parsed.amountNotes,

      applicationOpenDate: parsed.applicationOpenDate,
      applicationCloseDate: parsed.applicationCloseDate,
      dateNotes: parsed.dateNotes,

      checklist: parsed.checklist,
      applicationFormUrl: parsed.applicationFormUrl,
      applicationFormType: parsed.applicationFormType,
      applicationFormNotes: parsed.applicationFormNotes,

      eligibilityCriteria: parsed.eligibilityCriteria,

      scores,
      scoreChanges: parsed.scoreChanges ?? {
        alignment: unchanged(grant.scores.alignment),
        ease: unchanged(grant.scores.ease),
        attainability: unchanged(grant.scores.attainability),
      },

      additionalInfo: parsed.additionalInfo,
      keyContacts: parsed.keyContacts,
      pastRecipientNotes: parsed.pastRecipientNotes,
      sourcesUsed: parsed.sourcesUsed,
    };

    // Persist for this org here, on the server. The client no longer posts the
    // result back, so it survives a closed tab and cannot be tampered with.
    await getPool().query(
      `INSERT INTO deep_searches (org_id, grant_id, result_json, searched_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, grant_id) DO UPDATE SET
         result_json = EXCLUDED.result_json, searched_at = EXCLUDED.searched_at`,
      [orgId, deepResult.grantId, JSON.stringify(deepResult), deepResult.searchedAt],
    );

    // Write discovered fields back to the shared grants table (only fills NULLs —
    // never overwrites existing data). Only for grants that exist there, and only
    // values that pass the same checks we would apply to pipeline data.
    if (canWriteBack) {
      const formUrl = deepResult.applicationFormUrl;
      const closeDate = deepResult.applicationCloseDate;
      await writeDeepSearchUpdates(grant.id, {
        applicationFormUrl: formUrl && isSafeUrl(formUrl) ? formUrl : undefined,
        amountMin: deepResult.amountMin,
        amountMax: deepResult.amountMax,
        deadline: closeDate && ISO_DATE.test(closeDate) ? closeDate : undefined,
        eligibility: deepResult.eligibilityCriteria,
        keyContacts: deepResult.keyContacts,
      });
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const cost = computeCost(costs);
    console.log(
      `[DeepSearch] Complete in ${elapsed}s | ` +
      `Serper: ${costs.serperQueries} queries ($${cost.serper.toFixed(3)}) | ` +
      `Tavily: ${costs.tavilyUrls} URLs ($${cost.tavily.toFixed(3)}) | ` +
      `GPT-4o: ${costs.gpt4oIn}+${costs.gpt4oOut} tokens ($${cost.gpt.toFixed(3)}) | ` +
      `Total: $${cost.total.toFixed(3)}`,
    );

    return NextResponse.json(deepResult);
  } catch (err) {
    // Record what the failed attempt cost, then let authedRoute build the
    // response (ApiErrors keep their message; anything else becomes a generic 500).
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[DeepSearch] Failed after ${elapsed}s | Cost: $${computeCost(costs).total.toFixed(3)}`);
    throw err;
  }
});
