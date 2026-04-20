/**
 * Pipeline Step 3b: Retry failed funders with Playwright (headless browser).
 *
 * Targets funders that Step 3 marked as enriched but yielded no grants.
 * Many NZ charity sites block Tavily/raw fetch or require JS rendering.
 *
 * Usage:
 *   npx tsx scripts/pipeline/03b-extract-playwright.ts
 *   ... --force     # re-extract ALL funders (not just failures)
 *   ... --limit N   # process only N funders
 */

import { Pool } from '@neondatabase/serverless';
import {
  createPool, requireEnv, hasFlag, getFlagValue, logSection, logSummary,
} from '../../lib/pipeline/runner';
import {
  extractGrantsFromContent, validateAndEnrich,
  type FunderContext,
} from '../../lib/pipeline/extractor';
import { chromium, Browser, Page } from 'playwright';

requireEnv('OPENAI_API_KEY');

const CONCURRENCY = 20;
const MODEL = 'gpt-4o' as const;
const PAGE_CHAR_LIMIT = 80_000;
const NAVIGATE_TIMEOUT = 25_000;

interface FunderRow {
  id: number;
  name: string;
  website_url: string | null;
  purpose: string | null;
  source: string;
  curated_grant_url: string | null;
  regions: string[] | null;
}

// ─── Playwright Page Extraction ────────────────────────────────────────────

async function extractPageContent(page: Page, url: string): Promise<string | null> {
  try {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: NAVIGATE_TIMEOUT });
    } catch {
      // networkidle can be flaky — retry with domcontentloaded
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATE_TIMEOUT });
        await page.waitForTimeout(2000);
      } catch {
        return null;
      }
    }

    // Remove noise elements
    await page.evaluate(() => {
      const selectors = ['nav', 'header', 'footer', 'script', 'style', 'noscript',
                         '.cookie-banner', '#cookie-consent', '[role="banner"]', '[role="navigation"]'];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => el.remove());
      }
    });

    // Extract visible text
    const text = await page.evaluate(() => {
      const body = document.querySelector('body');
      if (!body) return '';
      return body.innerText || body.textContent || '';
    });

    // Extract links (for application form URLs)
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => `${(a as HTMLAnchorElement).textContent?.trim() || ''}: ${(a as HTMLAnchorElement).href}`)
        .filter(l => l.length > 3)
        .join('\n');
    });

    const combined = `${text}\n\n--- Links on page ---\n${links}`;
    return combined.slice(0, PAGE_CHAR_LIMIT) || null;
  } catch {
    return null;
  }
}

// ─── Per-Funder Extraction ─────────────────────────────────────────────────

async function extractFromFunder(
  funder: FunderRow,
  pool: Pool,
  browser: Browser,
): Promise<{ grants: number; status: string }> {
  const funderCtx: FunderContext = {
    id: funder.id,
    name: funder.name,
    purpose: funder.purpose,
    regions: funder.regions,
  };

  const grantPageUrl = funder.curated_grant_url || funder.website_url;
  if (!grantPageUrl) {
    return { grants: 0, status: 'no-url' };
  }

  // Fetch with Playwright
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  let combinedContent: string | null = null;
  const allPages = [grantPageUrl];

  try {
    combinedContent = await extractPageContent(page, grantPageUrl);

    // If we have a website URL different from curated URL, try that too
    if (!combinedContent && funder.website_url && funder.website_url !== grantPageUrl) {
      combinedContent = await extractPageContent(page, funder.website_url);
      if (combinedContent) allPages[0] = funder.website_url;
    }
  } finally {
    await page.close();
    await context.close();
  }

  if (!combinedContent || combinedContent.trim().length < 100) {
    return { grants: 0, status: 'fetch-failed' };
  }

  // Keyword check — broadened from Step 3
  const lc = combinedContent.toLowerCase();
  const hasGrantKeywords = lc.includes('grant') || lc.includes('fund')
    || lc.includes('funding') || lc.includes('community support')
    || lc.includes('application') || lc.includes('apply');

  const looksLikeDonationPage = /\b(donate|donation|support us|give now|fundrais|make a gift)\b/i.test(lc)
    && !(/\b(we fund|we offer|apply for|application|eligib|grant program|funding available|open for)\b/i.test(lc));

  if (!hasGrantKeywords || looksLikeDonationPage) {
    return { grants: 0, status: 'no-grants' };
  }

  // GPT-4o extraction
  let extraction;
  try {
    extraction = await extractGrantsFromContent(funderCtx, grantPageUrl, combinedContent, MODEL);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${funder.name}: GPT error — ${msg.slice(0, 100)}`);
    return { grants: 0, status: 'gpt-error' };
  }

  if (extraction.grants.length === 0) {
    return { grants: 0, status: 'no-grants' };
  }

  // Validate and enrich
  const validated = validateAndEnrich(
    extraction, funderCtx, grantPageUrl, combinedContent, allPages, MODEL,
  );

  if (validated.length === 0) {
    return { grants: 0, status: 'all-filtered' };
  }

  // Insert grants
  const realName = extraction.funder_name?.trim() || funder.name;
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
         $23, 2, 'extract-playwright', NOW()
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
         pipeline_version = 2, discovery_step = 'extract-playwright', updated_at = NOW()`,
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

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const pool = createPool();
  const force = hasFlag('--force');
  const limit = getFlagValue('--limit');
  const limitClause = limit ? `LIMIT ${parseInt(limit)}` : '';

  logSection('Step 3b: Playwright Re-extraction');

  // Target funders that were enriched but yielded no v2 grants
  // (i.e. the 948 that Step 3 marked as enriched_at IS NOT NULL but produced nothing)
  const query = force
    ? `SELECT id, name, website_url, purpose, source, curated_grant_url, regions
       FROM charities
       WHERE (website_url IS NOT NULL OR curated_grant_url IS NOT NULL)
         AND (source = 'curated' OR curated_grant_url IS NOT NULL
              OR (source = 'register' AND is_grant_maker = true))
       ORDER BY
         CASE WHEN source = 'curated' OR curated_grant_url IS NOT NULL THEN 0 ELSE 1 END, id
       ${limitClause}`
    : `SELECT c.id, c.name, c.website_url, c.purpose, c.source, c.curated_grant_url, c.regions
       FROM charities c
       WHERE c.enriched_at IS NOT NULL
         AND (c.website_url IS NOT NULL OR c.curated_grant_url IS NOT NULL)
         AND (c.source = 'curated' OR c.curated_grant_url IS NOT NULL
              OR (c.source = 'register' AND c.is_grant_maker = true))
         AND c.id NOT IN (
           SELECT DISTINCT funder_id FROM grants
           WHERE pipeline_version = 2 AND is_active
         )
       ORDER BY
         CASE WHEN c.source = 'curated' OR c.curated_grant_url IS NOT NULL THEN 0 ELSE 1 END, c.id
       ${limitClause}`;

  const { rows: funders } = await pool.query<FunderRow>(query);
  console.log(`  ${funders.length} funders to retry with Playwright${force ? ' (--force)' : ''}`);

  if (funders.length === 0) {
    console.log('  Nothing to process.');
    await pool.end();
    return;
  }

  // Launch browser
  console.log('  Launching Chromium...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  });

  let enriched = 0, noGrants = 0, failed = 0, totalGrants = 0;

  try {
    for (let i = 0; i < funders.length; i += CONCURRENCY) {
      const batch = funders.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(f => extractFromFunder(f, pool, browser))
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
        }
      }

      const done = Math.min(i + CONCURRENCY, funders.length);
      console.log(`  Progress: ${done}/${funders.length} | enriched: ${enriched} | grants: ${totalGrants} | no-grants: ${noGrants} | failed: ${failed}`);
    }
  } finally {
    await browser.close();
  }

  // Summary
  logSection('Summary');
  const { rows: grantStats } = await pool.query(`
    SELECT
      COUNT(*)::text AS v2_grants,
      COUNT(*) FILTER (WHERE individual_only = true)::text AS individual_only,
      AVG(data_quality_score)::integer AS avg_quality
    FROM grants WHERE is_active AND pipeline_version = 2
  `);

  const gs = grantStats[0];
  logSummary({
    'Funders retried': funders.length,
    'Newly enriched': enriched,
    'No grants found': noGrants,
    'Failed': failed,
    'New grants added': totalGrants,
    'Total v2 grants now': gs.v2_grants,
    'Individual-only': gs.individual_only,
    'Avg quality score': gs.avg_quality,
  });

  await pool.end();
}

main().catch(err => { console.error('Step 3b failed:', err); process.exit(1); });
