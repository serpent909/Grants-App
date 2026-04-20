/**
 * Pipeline Step 3: Extract grants from all confirmed grant-makers.
 *
 * Replaces: enrich-with-tavily.ts, enrich-with-playwright.ts
 *
 * Key changes from legacy:
 *   - Uses GPT-4o (not mini) for higher accuracy
 *   - Multi-page extraction (grant page + sub-pages) in one pass
 *   - Confidence tracking per field from the start
 *   - individual_only flag instead of deletion
 *
 * Usage:
 *   DATABASE_URL="..." OPENAI_API_KEY="..." TAVILY_API_KEY="..." npx tsx scripts/pipeline/03-extract-grants.ts
 *   ... --force    # re-extract already-enriched funders
 *   ... --limit N  # process only N funders
 */

import { Pool } from '@neondatabase/serverless';
import {
  createPool, requireEnv, hasFlag, getFlagValue, checkGate, logSection, logSummary,
} from '../../lib/pipeline/runner';
import { fetchPage, fetchMultiplePages } from '../../lib/pipeline/fetcher';
import {
  extractGrantsFromContent, validateAndEnrich,
  type FunderContext, type ValidatedGrant,
} from '../../lib/pipeline/extractor';
import { findBestGrantPage, findGrantLinksFromHtml } from '../../lib/nav-links';

requireEnv('OPENAI_API_KEY', 'TAVILY_API_KEY');

const CONCURRENCY = 8;
const MODEL = 'gpt-4o' as const;

interface FunderRow {
  id: number;
  name: string;
  website_url: string | null;
  purpose: string | null;
  source: string;
  curated_grant_url: string | null;
  regions: string[] | null;
}

// ─── Per-Funder Extraction ──────────────────────────────────────────────────

async function extractFromFunder(
  funder: FunderRow,
  pool: Pool,
): Promise<{ grants: number; status: string }> {
  const funderCtx: FunderContext = {
    id: funder.id,
    name: funder.name,
    purpose: funder.purpose,
    regions: funder.regions,
  };

  // Step 1: Find the grant page
  let grantPageUrl: string | null = null;

  if (funder.curated_grant_url) {
    grantPageUrl = funder.curated_grant_url;
  } else if (funder.website_url) {
    const bestPage = await findBestGrantPage(funder.website_url);
    grantPageUrl = bestPage?.url ?? null;
    if (!grantPageUrl) grantPageUrl = funder.website_url; // fallback to homepage
  }

  if (!grantPageUrl) {
    await pool.query(`UPDATE charities SET enriched_at = NOW() WHERE id = $1`, [funder.id]);
    return { grants: 0, status: 'no-url' };
  }

  // Step 2: Fetch grant page + discover sub-pages
  const mainResult = await fetchPage(grantPageUrl);
  if (!mainResult) {
    await pool.query(`UPDATE charities SET enriched_at = NOW() WHERE id = $1`, [funder.id]);
    return { grants: 0, status: 'fetch-failed' };
  }

  // Discover sub-pages (guidelines, eligibility, form) from nav links
  const subLinks = await findGrantLinksFromHtml(grantPageUrl);
  const subUrls = subLinks
    .filter(l => l.url !== grantPageUrl)
    .slice(0, 3)
    .map(l => l.url);

  let combinedContent = mainResult.content;
  const allPages = [grantPageUrl];

  if (subUrls.length > 0) {
    const subResults = await fetchMultiplePages(subUrls, { mainCharLimit: 15_000, subCharLimit: 15_000 });
    if (subResults.combined) {
      combinedContent += '\n\n' + subResults.combined;
    }
    allPages.push(...subResults.pages.map(p => p.url));
  }

  // Check for grant-giving keywords (skip donation-only pages)
  const lc = combinedContent.toLowerCase();
  const hasGrantKeywords = lc.includes('grant') || lc.includes('fund');
  const looksLikeDonationPage = /\b(donate|donation|support us|give now|fundrais|make a gift)\b/i.test(lc)
    && !(/\b(we fund|we offer|apply for|application|eligib|grant program)\b/i.test(lc));

  if (!hasGrantKeywords || looksLikeDonationPage) {
    await pool.query(`UPDATE charities SET enriched_at = NOW() WHERE id = $1`, [funder.id]);
    return { grants: 0, status: 'no-grants' };
  }

  // Step 3: GPT-4o extraction
  let extraction;
  try {
    extraction = await extractGrantsFromContent(funderCtx, grantPageUrl, combinedContent, MODEL);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${funder.name}: GPT error — ${msg.slice(0, 100)}`);
    await pool.query(`UPDATE charities SET enriched_at = NOW() WHERE id = $1`, [funder.id]);
    return { grants: 0, status: 'gpt-error' };
  }

  if (extraction.grants.length === 0) {
    await pool.query(`UPDATE charities SET enriched_at = NOW() WHERE id = $1`, [funder.id]);
    return { grants: 0, status: 'no-grants' };
  }

  // Step 4: Validate and enrich
  const validated = validateAndEnrich(
    extraction, funderCtx, grantPageUrl, combinedContent, allPages, MODEL,
  );

  if (validated.length === 0) {
    await pool.query(`UPDATE charities SET enriched_at = NOW() WHERE id = $1`, [funder.id]);
    return { grants: 0, status: 'all-filtered' };
  }

  // Step 5: Insert grants
  const realName = extraction.funder_name?.trim() || funder.name;
  if (funder.source === 'curated' && extraction.funder_name) {
    await pool.query(`UPDATE charities SET name = $1 WHERE id = $2`, [realName, funder.id]);
  }

  let count = 0;
  for (const g of validated) {
    await pool.query(
      `INSERT INTO grants (
         id, funder_id, funder_name, name, type, description, url,
         amount_min, amount_max, regions, sectors, eligibility,
         deadline, is_recurring, round_frequency, application_form_url,
         key_contacts, source_url, last_scraped_at, is_active,
         individual_only, field_confidence, extraction_model, extraction_pages,
         data_quality_score, pipeline_version, discovery_step, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12,
         $13, $14, $15, $16,
         $17, $18, NOW(), true,
         $19, $20, $21, $22,
         $23, 2, 'extract-tavily', NOW()
       )
       ON CONFLICT (id) DO UPDATE SET
         funder_name = EXCLUDED.funder_name, name = EXCLUDED.name,
         type = EXCLUDED.type, description = EXCLUDED.description,
         amount_min = EXCLUDED.amount_min, amount_max = EXCLUDED.amount_max,
         regions = EXCLUDED.regions, sectors = EXCLUDED.sectors,
         eligibility = EXCLUDED.eligibility, deadline = EXCLUDED.deadline,
         is_recurring = EXCLUDED.is_recurring, round_frequency = EXCLUDED.round_frequency,
         application_form_url = EXCLUDED.application_form_url,
         key_contacts = EXCLUDED.key_contacts, source_url = EXCLUDED.source_url,
         last_scraped_at = NOW(), is_active = true,
         individual_only = EXCLUDED.individual_only,
         field_confidence = EXCLUDED.field_confidence,
         extraction_model = EXCLUDED.extraction_model,
         extraction_pages = EXCLUDED.extraction_pages,
         data_quality_score = EXCLUDED.data_quality_score,
         pipeline_version = 2, discovery_step = 'extract-tavily', updated_at = NOW()`,
      [
        g.id, g.funder_id, g.funder_name, g.name, g.type, g.description, g.url,
        g.amount_min, g.amount_max, g.regions, g.sectors, g.eligibility,
        g.deadline, g.is_recurring, g.round_frequency, g.application_form_url,
        g.key_contacts, g.source_url,
        g.individual_only, JSON.stringify(g.field_confidence), g.extraction_model, g.extraction_pages,
        g.data_quality_score,
      ]
    );
    count++;
  }

  // Update funder enrichment state
  const summary = `${realName} offers ${validated.length > 1 ? `${validated.length} grant programs` : validated[0].name}. ${validated[0].description}`.slice(0, 1000);
  await pool.query(
    `UPDATE charities SET grant_url = $1, grant_summary = $2, enriched_at = NOW() WHERE id = $3`,
    [grantPageUrl, summary, funder.id]
  );

  console.log(`  ★ ${realName}: ${count} grant(s) extracted`);
  return { grants: count, status: 'enriched' };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const pool = createPool();
  const force = hasFlag('--force');
  const limit = getFlagValue('--limit');

  // Gate: classification must have been run
  await checkGate(
    pool,
    'At least 80% of register funders classified',
    `SELECT
       COUNT(*) FILTER (WHERE is_grant_maker IS NOT NULL)::text AS count,
       COUNT(*)::text AS total
     FROM charities WHERE source = 'register' AND website_url IS NOT NULL`,
    [],
    rows => {
      const classified = Number(rows[0].count);
      const total = Number((rows[0] as Record<string, string>).total);
      return total === 0 || (classified / total) >= 0.8;
    },
  );

  logSection('Step 3: Grant Extraction (GPT-4o)');

  const condition = force ? '' : 'AND enriched_at IS NULL';
  const limitClause = limit ? `LIMIT ${parseInt(limit)}` : '';

  const { rows: funders } = await pool.query<FunderRow>(
    `SELECT id, name, website_url, purpose, source, curated_grant_url, regions
     FROM charities
     WHERE (website_url IS NOT NULL OR curated_grant_url IS NOT NULL)
       AND (
         source = 'curated' OR curated_grant_url IS NOT NULL
         OR (source = 'register' AND (is_grant_maker = true OR (is_grant_maker IS NULL AND classification_confidence IS NOT NULL)))
       )
       ${condition}
     ORDER BY
       CASE
         WHEN source = 'curated' OR curated_grant_url IS NOT NULL THEN 0
         WHEN is_grant_maker = true AND classification_confidence = 'high' THEN 1
         WHEN is_grant_maker = true AND classification_confidence = 'medium' THEN 2
         ELSE 3
       END, id
     ${limitClause}`
  );

  console.log(`  ${funders.length} funders to extract${force ? ' (--force)' : ''}`);
  if (funders.length === 0) { await pool.end(); return; }

  let enriched = 0, noGrants = 0, failed = 0, totalGrants = 0;
  const tavilyCalls = { n: 0 };

  for (let i = 0; i < funders.length; i += CONCURRENCY) {
    const batch = funders.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(f => extractFromFunder(f, pool))
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value.grants > 0) {
          enriched++;
          totalGrants += r.value.grants;
        } else {
          noGrants++;
        }
      } else {
        failed++;
        console.error('  Error:', r.reason);
      }
    }

    const done = Math.min(i + CONCURRENCY, funders.length);
    console.log(`  Progress: ${done}/${funders.length} | enriched: ${enriched} | grants: ${totalGrants} | no-grants: ${noGrants}`);
  }

  // Quality gate
  logSection('Quality Gate');
  const { rows: grantStats } = await pool.query(`
    SELECT
      COUNT(*) AS total_active,
      COUNT(*) FILTER (WHERE pipeline_version = 2) AS v2_grants,
      COUNT(*) FILTER (WHERE individual_only = true) AS individual_only,
      AVG(data_quality_score)::integer AS avg_quality,
      COUNT(*) FILTER (WHERE description IS NOT NULL AND length(description) > 50) AS with_description
    FROM grants WHERE is_active
  `);

  const gs = grantStats[0];
  logSummary({
    'Funders enriched': enriched,
    'Funders with no grants': noGrants,
    'Funders failed': failed,
    'Total grants inserted': totalGrants,
    'Active grants (v2)': gs.v2_grants,
    'Individual-only grants': gs.individual_only,
    'Avg quality score': gs.avg_quality,
    'With description': gs.with_description,
  });

  if (Number(gs.v2_grants) < 4000) {
    console.log(`\n⚠  Only ${gs.v2_grants} v2 grants — target is 5,000+ before dedup.`);
  } else {
    console.log(`\n✓  ${gs.v2_grants} v2 grants extracted (target: 5,000+).`);
  }

  await pool.end();
}

main().catch(err => { console.error('Pipeline step 3 failed:', err); process.exit(1); });
