/**
 * Pipeline Step 9: Standalone coverage report.
 *
 * Run at any time to see the current state of the database.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/pipeline/09-coverage-report.ts
 *   ... --v1  # also show v1 (legacy) grant stats
 */

import { createPool, hasFlag, logSection } from '../../lib/pipeline/runner';

async function main() {
  const pool = createPool();
  const showV1 = hasFlag('--v1');

  logSection('GrantSearch NZ — Coverage Report');

  // Overall counts
  const { rows: overall } = await pool.query(`
    SELECT
      COUNT(*) AS total_grants,
      COUNT(*) FILTER (WHERE is_active) AS active_grants,
      COUNT(*) FILTER (WHERE is_active AND pipeline_version = 2) AS v2_active,
      COUNT(*) FILTER (WHERE is_active AND pipeline_version = 1) AS v1_active,
      COUNT(*) FILTER (WHERE NOT is_active) AS inactive,
      COUNT(*) FILTER (WHERE individual_only = true AND is_active) AS individual_only
    FROM grants
  `);

  const o = overall[0];
  console.log('\n  Grant Counts:');
  console.log(`    Total in DB:         ${o.total_grants}`);
  console.log(`    Active (all):        ${o.active_grants}`);
  console.log(`    Active v2:           ${o.v2_active}`);
  if (showV1) console.log(`    Active v1 (legacy):  ${o.v1_active}`);
  console.log(`    Inactive:            ${o.inactive}`);
  console.log(`    Individual-only:     ${o.individual_only}`);

  // Field coverage (v2 only)
  const { rows: coverage } = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE description IS NOT NULL AND length(description) > 50) AS description,
      COUNT(*) FILTER (WHERE eligibility IS NOT NULL AND array_length(eligibility, 1) >= 2) AS eligibility,
      COUNT(*) FILTER (WHERE amount_max IS NOT NULL) AS amount,
      COUNT(*) FILTER (WHERE amount_min IS NOT NULL) AS amount_min,
      COUNT(*) FILTER (WHERE deadline IS NOT NULL AND deadline != '') AS deadline,
      COUNT(*) FILTER (WHERE application_form_url IS NOT NULL) AS form_url,
      COUNT(*) FILTER (WHERE sectors IS NOT NULL AND array_length(sectors, 1) >= 1) AS sectors,
      COUNT(*) FILTER (WHERE regions IS NOT NULL AND array_length(regions, 1) >= 1) AS regions,
      COUNT(*) FILTER (WHERE key_contacts IS NOT NULL) AS contacts,
      COUNT(*) FILTER (WHERE is_recurring = true) AS recurring,
      AVG(data_quality_score)::integer AS avg_quality,
      MIN(data_quality_score) AS min_quality,
      MAX(data_quality_score) AS max_quality,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY data_quality_score)::integer AS median_quality
    FROM grants WHERE is_active AND pipeline_version = 2 AND (individual_only IS NULL OR individual_only = false)
  `);

  const c = coverage[0];
  const total = Number(c.total);
  const pct = (field: string) => {
    const n = Number(c[field as keyof typeof c]);
    return total > 0 ? `${n} (${(n / total * 100).toFixed(1)}%)` : '0';
  };

  console.log('\n  Field Coverage (v2 active, excluding individual-only):');
  console.log(`    Total:               ${total}`);
  console.log(`    description:         ${pct('description')}`);
  console.log(`    eligibility (≥2):    ${pct('eligibility')}`);
  console.log(`    amount_max:          ${pct('amount')}`);
  console.log(`    amount_min:          ${pct('amount_min')}`);
  console.log(`    deadline:            ${pct('deadline')}`);
  console.log(`    application_form_url:${pct('form_url')}`);
  console.log(`    sectors (≥1):        ${pct('sectors')}`);
  console.log(`    regions (≥1):        ${pct('regions')}`);
  console.log(`    key_contacts:        ${pct('contacts')}`);
  console.log(`    is_recurring:        ${pct('recurring')}`);

  console.log('\n  Quality Score Stats:');
  console.log(`    Average:  ${c.avg_quality}`);
  console.log(`    Median:   ${c.median_quality}`);
  console.log(`    Min:      ${c.min_quality}`);
  console.log(`    Max:      ${c.max_quality}`);

  // Quality distribution
  const { rows: distrib } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE data_quality_score < 20) AS q0_19,
      COUNT(*) FILTER (WHERE data_quality_score >= 20 AND data_quality_score < 40) AS q20_39,
      COUNT(*) FILTER (WHERE data_quality_score >= 40 AND data_quality_score < 60) AS q40_59,
      COUNT(*) FILTER (WHERE data_quality_score >= 60 AND data_quality_score < 80) AS q60_79,
      COUNT(*) FILTER (WHERE data_quality_score >= 80) AS q80_100,
      COUNT(*) FILTER (WHERE data_quality_score IS NULL) AS q_null
    FROM grants WHERE is_active AND pipeline_version = 2
  `);

  const d = distrib[0];
  console.log('\n  Quality Score Distribution:');
  console.log(`    0-19  (low):         ${d.q0_19}`);
  console.log(`    20-39 (medium-low):  ${d.q20_39}`);
  console.log(`    40-59 (medium):      ${d.q40_59}`);
  console.log(`    60-79 (medium-high): ${d.q60_79}`);
  console.log(`    80-100 (high):       ${d.q80_100}`);
  if (Number(d.q_null) > 0) console.log(`    NULL (unscored):     ${d.q_null}`);

  // Confidence tracking
  const { rows: confDistrib } = await pool.query(`
    SELECT extraction_model, COUNT(*) AS n
    FROM grants WHERE is_active AND pipeline_version = 2
    GROUP BY extraction_model ORDER BY n DESC
  `);
  console.log('\n  Extraction Model:');
  for (const row of confDistrib) {
    console.log(`    ${String(row.extraction_model || 'unknown').padEnd(15)} ${row.n}`);
  }

  // Funder type distribution
  const { rows: funderTypes } = await pool.query(`
    SELECT COALESCE(c.funder_type, 'unknown') AS funder_type, COUNT(*) AS n
    FROM grants g LEFT JOIN charities c ON c.id = g.funder_id
    WHERE g.is_active AND g.pipeline_version = 2
    GROUP BY c.funder_type ORDER BY n DESC
  `);
  console.log('\n  By Funder Type:');
  for (const row of funderTypes) {
    console.log(`    ${String(row.funder_type).padEnd(22)} ${row.n}`);
  }

  // Grant type distribution
  const { rows: grantTypes } = await pool.query(`
    SELECT type, COUNT(*) AS n
    FROM grants WHERE is_active AND pipeline_version = 2
    GROUP BY type ORDER BY n DESC
  `);
  console.log('\n  By Grant Type:');
  for (const row of grantTypes) {
    console.log(`    ${String(row.type).padEnd(22)} ${row.n}`);
  }

  // Charities summary
  const { rows: charitySummary } = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE is_grant_maker = true) AS grant_makers,
      COUNT(*) FILTER (WHERE is_grant_maker = false) AS not_grant_makers,
      COUNT(*) FILTER (WHERE is_grant_maker IS NULL) AS unclassified,
      COUNT(*) FILTER (WHERE source = 'register') AS from_register,
      COUNT(*) FILTER (WHERE source = 'curated') AS from_curated,
      COUNT(*) FILTER (WHERE discovery_source = 'directory') AS from_directory,
      COUNT(*) FILTER (WHERE discovery_source = 'search') AS from_search,
      COUNT(*) FILTER (WHERE website_url IS NOT NULL) AS with_website
    FROM charities
  `);

  const cs = charitySummary[0];
  console.log('\n  Charities/Funders:');
  console.log(`    Total:               ${cs.total}`);
  console.log(`    Grant-makers:        ${cs.grant_makers}`);
  console.log(`    Not grant-makers:    ${cs.not_grant_makers}`);
  console.log(`    Unclassified:        ${cs.unclassified}`);
  console.log(`    From register:       ${cs.from_register}`);
  console.log(`    From curated:        ${cs.from_curated}`);
  console.log(`    From directories:    ${cs.from_directory}`);
  console.log(`    From search:         ${cs.from_search}`);
  console.log(`    With website:        ${cs.with_website}`);

  console.log('');
  await pool.end();
}

main().catch(err => { console.error('Coverage report failed:', err); process.exit(1); });
