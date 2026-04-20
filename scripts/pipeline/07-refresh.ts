/**
 * Pipeline Step 7: Quarterly maintenance refresh.
 *
 * Designed to run quarterly to keep the database current.
 *
 * What it does:
 *   1. Re-verify all URLs (deactivate dead ones)
 *   2. Re-check known funders for new grants
 *   3. Discover new funders from directories
 *   4. Update deadlines for recurring grants
 *   5. Deactivate expired grants
 *   6. Re-compute quality scores
 *
 * Usage:
 *   DATABASE_URL="..." OPENAI_API_KEY="..." TAVILY_API_KEY="..." npx tsx scripts/pipeline/07-refresh.ts
 *   ... --skip-url-check     # skip URL verification
 *   ... --skip-new-funders   # skip new funder discovery
 *   ... --limit N            # limit new grant extraction to N funders
 */

import {
  createPool, requireEnv, hasFlag, getFlagValue, logSection, logSummary,
} from '../../lib/pipeline/runner';
import { headCheck, fetchPage, tavilyExtract } from '../../lib/pipeline/fetcher';
import { extractGrantsFromContent, validateAndEnrich, type FunderContext } from '../../lib/pipeline/extractor';
import { computeQualityScore } from '../../lib/pipeline/quality';
import { findBestGrantPage, findGrantLinksFromHtml } from '../../lib/nav-links';

requireEnv('OPENAI_API_KEY', 'TAVILY_API_KEY');

const HEAD_CONCURRENCY = 25;
const EXTRACT_CONCURRENCY = 5;
const GRACE_PERIOD_DAYS = 30;

async function main() {
  const pool = createPool();
  const limit = getFlagValue('--limit');

  console.log(`\n  Quarterly refresh started at ${new Date().toISOString()}\n`);

  // ═══ Step 1: URL Verification ═══

  if (!hasFlag('--skip-url-check')) {
    logSection('Step 1: Re-verify URLs');

    const { rows: urls } = await pool.query<{ source_url: string }>(
      `SELECT DISTINCT source_url FROM grants
       WHERE is_active AND pipeline_version = 2 AND source_url IS NOT NULL`
    );

    let dead = 0;
    for (let i = 0; i < urls.length; i += HEAD_CONCURRENCY) {
      const batch = urls.slice(i, i + HEAD_CONCURRENCY);
      const results = await Promise.allSettled(batch.map(u => headCheck(u.source_url)));
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        if (!r.value.alive && (r.value.status === 404 || r.value.status === 410 || r.value.error?.includes('ENOTFOUND'))) {
          await pool.query(
            `UPDATE grants SET is_active = false, scrape_notes = 'refresh:dead-url' WHERE is_active AND source_url = $1`,
            [r.value.url]
          );
          dead++;
        }
      }
    }
    console.log(`  Checked ${urls.length} URLs | Dead: ${dead}`);
  }

  // ═══ Step 2: Re-check known funders for new grants ═══

  logSection('Step 2: Check for New Grants');

  const limitClause = limit ? `LIMIT ${parseInt(limit)}` : 'LIMIT 200';
  const { rows: funders } = await pool.query<{
    id: number; name: string; website_url: string | null; purpose: string | null;
    curated_grant_url: string | null; regions: string[] | null; enriched_at: string | null;
  }>(`SELECT id, name, website_url, purpose, curated_grant_url, regions, enriched_at
      FROM charities
      WHERE is_grant_maker = true AND (website_url IS NOT NULL OR curated_grant_url IS NOT NULL)
      ORDER BY enriched_at ASC NULLS FIRST
      ${limitClause}`);

  console.log(`  Re-checking ${funders.length} funders for new grants...`);

  let newGrants = 0;
  for (let i = 0; i < funders.length; i += EXTRACT_CONCURRENCY) {
    const batch = funders.slice(i, i + EXTRACT_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(async funder => {
      const grantPageUrl = funder.curated_grant_url || (await findBestGrantPage(funder.website_url!))?.url || funder.website_url;
      if (!grantPageUrl) return 0;

      const pageResult = await fetchPage(grantPageUrl);
      if (!pageResult) return 0;

      const funderCtx: FunderContext = {
        id: funder.id, name: funder.name, purpose: funder.purpose, regions: funder.regions,
      };

      const extraction = await extractGrantsFromContent(funderCtx, grantPageUrl, pageResult.content, 'gpt-4o');
      if (extraction.grants.length === 0) return 0;

      const validated = validateAndEnrich(
        extraction, funderCtx, grantPageUrl, pageResult.content, [grantPageUrl], 'gpt-4o',
      );

      let count = 0;
      for (const g of validated) {
        // INSERT ... ON CONFLICT DO NOTHING — only add truly new grants
        const result = await pool.query(
          `INSERT INTO grants (
             id, funder_id, funder_name, name, type, description, url,
             amount_min, amount_max, regions, sectors, eligibility,
             deadline, is_recurring, round_frequency, application_form_url,
             key_contacts, source_url, last_scraped_at, is_active,
             individual_only, field_confidence, extraction_model, extraction_pages,
             data_quality_score, pipeline_version, discovery_step, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),true,$19,$20,$21,$22,$23,2,'refresh',NOW())
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [
            g.id, g.funder_id, g.funder_name, g.name, g.type, g.description, g.url,
            g.amount_min, g.amount_max, g.regions, g.sectors, g.eligibility,
            g.deadline, g.is_recurring, g.round_frequency, g.application_form_url,
            g.key_contacts, g.source_url,
            g.individual_only, JSON.stringify(g.field_confidence), g.extraction_model, g.extraction_pages,
            g.data_quality_score,
          ]
        );
        if (result.rows.length > 0) count++;
      }

      await pool.query(`UPDATE charities SET enriched_at = NOW() WHERE id = $1`, [funder.id]);
      return count;
    }));

    for (const r of results) {
      if (r.status === 'fulfilled') newGrants += r.value;
    }

    const done = Math.min(i + EXTRACT_CONCURRENCY, funders.length);
    console.log(`  ${done}/${funders.length} funders checked | ${newGrants} new grants found`);
  }

  // ═══ Step 3: Deadline Management ═══

  logSection('Step 3: Deadline Management');

  const today = new Date().toISOString().slice(0, 10);
  const { rows: pastDeadlines } = await pool.query<{
    id: string; deadline: string; is_recurring: boolean | null; round_frequency: string | null;
  }>(`SELECT id, deadline, is_recurring, round_frequency FROM grants
      WHERE is_active AND pipeline_version = 2
        AND deadline ~ '^\\d{4}-\\d{2}-\\d{2}' AND deadline::date < $1::date`, [today]);

  let converted = 0, deactivated = 0;
  for (const g of pastDeadlines) {
    const daysPast = Math.floor((Date.now() - new Date(g.deadline).getTime()) / (1000 * 60 * 60 * 24));
    if (daysPast <= GRACE_PERIOD_DAYS) continue;

    if (g.is_recurring || g.round_frequency === 'annual' || g.round_frequency === 'biannual') {
      const month = new Date(g.deadline).toLocaleString('en-NZ', { month: 'long' });
      await pool.query(`UPDATE grants SET deadline = $1, updated_at = NOW() WHERE id = $2`,
        [`${g.round_frequency || 'annual'} - typically ${month}`, g.id]);
      converted++;
    } else {
      await pool.query(`UPDATE grants SET is_active = false, scrape_notes = 'refresh:expired' WHERE id = $1`, [g.id]);
      deactivated++;
    }
  }
  console.log(`  Converted to text schedule: ${converted} | Deactivated: ${deactivated}`);

  // ═══ Step 4: Recompute Quality Scores ═══

  logSection('Step 4: Recompute Quality Scores');

  const { rows: allActive } = await pool.query<{
    id: string; description: string | null; eligibility: string[] | null;
    amount_max: number | null; deadline: string | null;
    application_form_url: string | null; sectors: string[] | null;
    regions: string[] | null; key_contacts: string | null;
  }>(`SELECT id, description, eligibility, amount_max, deadline,
            application_form_url, sectors, regions, key_contacts
      FROM grants WHERE is_active AND pipeline_version = 2`);

  for (const g of allActive) {
    await pool.query(`UPDATE grants SET data_quality_score = $1, last_verified_at = NOW() WHERE id = $2`,
      [computeQualityScore(g), g.id]);
  }

  // ═══ Summary ═══

  logSection('Refresh Summary');
  const { rows: finalStats } = await pool.query(`
    SELECT COUNT(*) AS total, AVG(data_quality_score)::integer AS avg_quality
    FROM grants WHERE is_active AND pipeline_version = 2
  `);

  logSummary({
    'New grants discovered': newGrants,
    'Deadlines converted': converted,
    'Grants deactivated (expired)': deactivated,
    'Total active v2 grants': finalStats[0].total,
    'Avg quality score': finalStats[0].avg_quality,
  });

  await pool.end();
}

main().catch(err => { console.error('Refresh failed:', err); process.exit(1); });
