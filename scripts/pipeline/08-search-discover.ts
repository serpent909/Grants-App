/**
 * Pipeline Step 8: Search-based discovery of new funders.
 *
 * Finds NZ grant-making organisations NOT already in the database using
 * Serper/Tavily search queries. New funders are classified and extracted.
 *
 * Usage:
 *   DATABASE_URL="..." OPENAI_API_KEY="..." TAVILY_API_KEY="..." npx tsx scripts/pipeline/08-search-discover.ts
 *   ... --dry-run   # discover but don't insert
 *   ... --limit N   # limit search queries
 */

import {
  createPool, requireEnv, hasFlag, getFlagValue, logSection, logSummary,
} from '../../lib/pipeline/runner';
import { tavilySearch, fetchPage } from '../../lib/pipeline/fetcher';
import {
  classifyGrantMakers, extractGrantsFromContent, validateAndEnrich,
  type FunderContext,
} from '../../lib/pipeline/extractor';
import { createHash } from 'crypto';

requireEnv('OPENAI_API_KEY', 'TAVILY_API_KEY');

const DRY_RUN = hasFlag('--dry-run');

// Search query templates for discovering NZ grant funders
const SEARCH_QUERIES = [
  'New Zealand community grants apply 2026',
  'NZ charitable trust funding applications',
  'New Zealand foundation grants for nonprofits',
  'NZ government community funding programme',
  'New Zealand gaming trust grants',
  'NZ community trust funding rounds',
  'apply for grants New Zealand charities',
  'NZ regional council community grants',
  'New Zealand arts culture funding apply',
  'NZ sport recreation community grants',
  'New Zealand environmental conservation grants',
  'NZ health disability community funding',
  'New Zealand education training grants charities',
  'NZ youth development community funding',
  'New Zealand housing homelessness grants',
  'iwi Māori community grants funding NZ',
];

function bareHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

async function main() {
  const pool = createPool();
  const limit = parseInt(getFlagValue('--limit') || String(SEARCH_QUERIES.length));

  logSection('Step 8: Search-Based Discovery');

  // Load existing funder hostnames
  const { rows: existing } = await pool.query<{ website_url: string; curated_grant_url: string }>(
    `SELECT website_url, curated_grant_url FROM charities WHERE website_url IS NOT NULL OR curated_grant_url IS NOT NULL`
  );
  const knownHosts = new Set<string>();
  for (const row of existing) {
    if (row.website_url) knownHosts.add(bareHostname(row.website_url));
    if (row.curated_grant_url) knownHosts.add(bareHostname(row.curated_grant_url));
  }
  console.log(`  ${knownHosts.size} known funder hostnames`);

  // Search for new funders
  const newFunderUrls = new Map<string, { url: string; title: string }>();
  const queries = SEARCH_QUERIES.slice(0, limit);

  for (const query of queries) {
    const results = await tavilySearch(query, 10);
    for (const r of results) {
      const host = bareHostname(r.url);
      if (!host || knownHosts.has(host) || newFunderUrls.has(host)) continue;
      // Filter out generic/directory sites
      if (['google.com', 'facebook.com', 'linkedin.com', 'wikipedia.org', 'govt.nz',
           'charities.govt.nz', 'fundinginformation.org.nz', 'generosity.org.nz',
           'communitymatters.govt.nz', 'philanthropy.org.nz'].some(d => host.includes(d))) continue;
      newFunderUrls.set(host, { url: r.url, title: r.title });
    }
    console.log(`  "${query.slice(0, 50)}..." → ${results.length} results`);
  }

  console.log(`\n  ${newFunderUrls.size} potential new funders discovered`);

  if (DRY_RUN) {
    console.log('\n  DRY RUN — Discovered URLs:');
    for (const [host, { url, title }] of newFunderUrls) {
      console.log(`    ${host}: ${title} (${url})`);
    }
    await pool.end();
    return;
  }

  // Classify and extract
  let inserted = 0, grantsFound = 0;

  for (const [host, { url, title }] of newFunderUrls) {
    // Insert as new funder
    const charityNumber = 'SD' + createHash('sha256').update(url).digest('hex').slice(0, 8).toUpperCase();
    const name = title.replace(/ - .*$/, '').trim() || host;

    try {
      await pool.query(
        `INSERT INTO charities (charity_number, name, website_url, source, curated_grant_url, discovery_source)
         VALUES ($1, $2, $3, 'curated', $3, 'search')
         ON CONFLICT (charity_number) DO NOTHING`,
        [charityNumber, name, url]
      );

      // Get the inserted ID
      const { rows } = await pool.query<{ id: number }>(
        `SELECT id FROM charities WHERE charity_number = $1`, [charityNumber]
      );
      if (rows.length === 0) continue;

      const funderId = rows[0].id;
      inserted++;

      // Try to extract grants
      const pageResult = await fetchPage(url);
      if (!pageResult) continue;

      const funderCtx: FunderContext = { id: funderId, name, purpose: null, regions: null };
      const extraction = await extractGrantsFromContent(funderCtx, url, pageResult.content, 'gpt-4o');

      if (extraction.grants.length > 0) {
        const validated = validateAndEnrich(
          extraction, funderCtx, url, pageResult.content, [url], 'gpt-4o',
        );
        for (const g of validated) {
          await pool.query(
            `INSERT INTO grants (
               id, funder_id, funder_name, name, type, description, url,
               amount_min, amount_max, regions, sectors, eligibility,
               deadline, is_recurring, round_frequency, application_form_url,
               key_contacts, source_url, last_scraped_at, is_active,
               individual_only, field_confidence, extraction_model, extraction_pages,
               data_quality_score, pipeline_version, discovery_step, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),true,$19,$20,$21,$22,$23,2,'search-discover',NOW())
             ON CONFLICT (id) DO NOTHING`,
            [
              g.id, g.funder_id, g.funder_name, g.name, g.type, g.description, g.url,
              g.amount_min, g.amount_max, g.regions, g.sectors, g.eligibility,
              g.deadline, g.is_recurring, g.round_frequency, g.application_form_url,
              g.key_contacts, g.source_url,
              g.individual_only, JSON.stringify(g.field_confidence), g.extraction_model, g.extraction_pages,
              g.data_quality_score,
            ]
          );
          grantsFound++;
        }
        console.log(`  ★ ${name}: ${validated.length} grants`);
      }

      await pool.query(`UPDATE charities SET enriched_at = NOW(), is_grant_maker = true WHERE id = $1`, [funderId]);
    } catch (err) {
      console.error(`  Error processing ${host}:`, err);
    }
  }

  logSummary({
    'Search queries run': queries.length,
    'New funder URLs found': newFunderUrls.size,
    'Funders inserted': inserted,
    'Grants extracted': grantsFound,
  });

  await pool.end();
}

main().catch(err => { console.error('Pipeline step 8 failed:', err); process.exit(1); });
