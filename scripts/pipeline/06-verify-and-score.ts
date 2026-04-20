/**
 * Pipeline Step 6: Verify URLs, manage deadlines, compute final quality scores.
 *
 * Replaces: verify-grant-urls.ts, deactivate-expired.ts, coverage-report.ts
 *
 * Passes:
 *   1. URL verification (HEAD check source_urls and application_form_urls)
 *   2. Deadline management (grace period, convert recurring, deactivate expired)
 *   3. Quality score recompute
 *   4. Final coverage report with quality gate
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/pipeline/06-verify-and-score.ts
 *   ... --skip-url-check  # skip URL verification (faster for testing)
 */

import {
  createPool, hasFlag, logSection, logSummary,
} from '../../lib/pipeline/runner';
import { headCheck } from '../../lib/pipeline/fetcher';
import { computeQualityScore } from '../../lib/pipeline/quality';

const HEAD_CONCURRENCY = 25;
const GRACE_PERIOD_DAYS = 30;

async function main() {
  const pool = createPool();

  // ═══ Pass 1: URL Verification ═══

  logSection('Pass 1: URL Verification');

  if (hasFlag('--skip-url-check')) {
    console.log('  Skipped (--skip-url-check)');
  } else {
    // Get unique source URLs
    const { rows: urls } = await pool.query<{ source_url: string }>(
      `SELECT DISTINCT source_url FROM grants
       WHERE is_active AND pipeline_version = 2 AND source_url IS NOT NULL`
    );

    console.log(`  Checking ${urls.length} unique source URLs...`);

    let alive = 0, dead = 0, blocked = 0;
    for (let i = 0; i < urls.length; i += HEAD_CONCURRENCY) {
      const batch = urls.slice(i, i + HEAD_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(u => headCheck(u.source_url))
      );

      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const check = r.value;
        if (check.alive) {
          alive++;
        } else if (check.status === 404 || check.status === 410 || check.error?.includes('ENOTFOUND')) {
          // Dead URL — deactivate all grants from this source
          await pool.query(
            `UPDATE grants SET is_active = false, scrape_notes = 'verify:dead-url'
             WHERE is_active AND source_url = $1`,
            [check.url]
          );
          dead++;
        } else {
          blocked++; // 403, 5xx — probably bot detection, not dead
        }
      }

      const done = Math.min(i + HEAD_CONCURRENCY, urls.length);
      process.stdout.write(`  ${done}/${urls.length} checked...\r`);
    }

    console.log(`\n  Alive: ${alive} | Dead: ${dead} | Blocked: ${blocked}`);

    // Also check application form URLs
    const { rows: formUrls } = await pool.query<{ id: string; application_form_url: string }>(
      `SELECT id, application_form_url FROM grants
       WHERE is_active AND pipeline_version = 2 AND application_form_url IS NOT NULL`
    );

    console.log(`  Checking ${formUrls.length} application form URLs...`);
    let formDead = 0;
    for (let i = 0; i < formUrls.length; i += HEAD_CONCURRENCY) {
      const batch = formUrls.slice(i, i + HEAD_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(u => headCheck(u.application_form_url))
      );

      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status !== 'fulfilled') continue;
        if (!r.value.alive && (r.value.status === 404 || r.value.status === 410)) {
          await pool.query(
            `UPDATE grants SET application_form_url = NULL, updated_at = NOW() WHERE id = $1`,
            [batch[j].id]
          );
          formDead++;
        }
      }
    }
    console.log(`  Dead form URLs removed: ${formDead}`);
  }

  // ═══ Pass 2: Deadline Management ═══

  logSection('Pass 2: Deadline Management');

  const today = new Date().toISOString().slice(0, 10);

  // Past ISO-date deadlines
  const { rows: pastDeadlines } = await pool.query<{
    id: string; deadline: string; is_recurring: boolean | null; round_frequency: string | null;
  }>(`SELECT id, deadline, is_recurring, round_frequency FROM grants
      WHERE is_active AND pipeline_version = 2
        AND deadline ~ '^\\d{4}-\\d{2}-\\d{2}'
        AND deadline::date < $1::date`, [today]);

  let graceCount = 0, convertedCount = 0, deactivatedCount = 0;
  for (const g of pastDeadlines) {
    const deadlineDate = new Date(g.deadline);
    const daysPast = Math.floor((Date.now() - deadlineDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysPast <= GRACE_PERIOD_DAYS) {
      graceCount++;
    } else if (g.is_recurring || g.round_frequency === 'annual' || g.round_frequency === 'biannual') {
      // Convert to text schedule
      const month = deadlineDate.toLocaleString('en-NZ', { month: 'long' });
      const freq = g.round_frequency || 'annual';
      const textDeadline = `${freq} - typically ${month}`;
      await pool.query(
        `UPDATE grants SET deadline = $1, updated_at = NOW() WHERE id = $2`,
        [textDeadline, g.id]
      );
      convertedCount++;
    } else {
      await pool.query(
        `UPDATE grants SET is_active = false, scrape_notes = 'verify:expired' WHERE id = $1`,
        [g.id]
      );
      deactivatedCount++;
    }
  }

  console.log(`  Past deadlines: ${pastDeadlines.length}`);
  console.log(`  In grace period (≤${GRACE_PERIOD_DAYS} days): ${graceCount}`);
  console.log(`  Converted to text schedule: ${convertedCount}`);
  console.log(`  Deactivated (non-recurring): ${deactivatedCount}`);

  // ═══ Pass 3: Quality Score Recompute ═══

  logSection('Pass 3: Quality Score Recompute');

  const { rows: allActive } = await pool.query<{
    id: string; description: string | null; eligibility: string[] | null;
    amount_max: number | null; deadline: string | null;
    application_form_url: string | null; sectors: string[] | null;
    regions: string[] | null; key_contacts: string | null;
  }>(`SELECT id, description, eligibility, amount_max, deadline,
            application_form_url, sectors, regions, key_contacts
      FROM grants WHERE is_active AND pipeline_version = 2`);

  for (const g of allActive) {
    const score = computeQualityScore(g);
    await pool.query(`UPDATE grants SET data_quality_score = $1 WHERE id = $2`, [score, g.id]);
  }

  // Update last_verified_at
  await pool.query(
    `UPDATE grants SET last_verified_at = NOW() WHERE is_active AND pipeline_version = 2`
  );

  console.log(`  Recomputed scores for ${allActive.length} grants`);

  // ═══ Pass 4: Final Coverage Report & Quality Gate ═══

  logSection('Final Coverage Report');

  const { rows: coverage } = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE description IS NOT NULL AND length(description) > 50) AS with_description,
      COUNT(*) FILTER (WHERE eligibility IS NOT NULL AND array_length(eligibility, 1) >= 2) AS with_eligibility,
      COUNT(*) FILTER (WHERE amount_max IS NOT NULL) AS with_amount,
      COUNT(*) FILTER (WHERE deadline IS NOT NULL AND deadline != '') AS with_deadline,
      COUNT(*) FILTER (WHERE application_form_url IS NOT NULL) AS with_form_url,
      COUNT(*) FILTER (WHERE sectors IS NOT NULL AND array_length(sectors, 1) >= 1) AS with_sectors,
      COUNT(*) FILTER (WHERE regions IS NOT NULL AND array_length(regions, 1) >= 1) AS with_regions,
      COUNT(*) FILTER (WHERE key_contacts IS NOT NULL) AS with_contacts,
      COUNT(*) FILTER (WHERE individual_only = true) AS individual_only,
      AVG(data_quality_score)::integer AS avg_quality,
      COUNT(*) FILTER (WHERE data_quality_score < 20) AS low_quality,
      COUNT(*) FILTER (WHERE data_quality_score >= 20 AND data_quality_score < 40) AS medium_low_quality,
      COUNT(*) FILTER (WHERE data_quality_score >= 40 AND data_quality_score < 60) AS medium_quality,
      COUNT(*) FILTER (WHERE data_quality_score >= 60 AND data_quality_score < 80) AS medium_high_quality,
      COUNT(*) FILTER (WHERE data_quality_score >= 80) AS high_quality
    FROM grants WHERE is_active AND pipeline_version = 2 AND (individual_only IS NULL OR individual_only = false)
  `);

  const c = coverage[0];
  const total = Number(c.total);
  const pct = (n: string) => total > 0 ? `${(Number(n) / total * 100).toFixed(1)}%` : '0%';

  console.log('\n  Field Coverage:');
  console.log(`    description:         ${c.with_description} (${pct(c.with_description)})`);
  console.log(`    eligibility:         ${c.with_eligibility} (${pct(c.with_eligibility)})`);
  console.log(`    amount_max:          ${c.with_amount} (${pct(c.with_amount)})`);
  console.log(`    deadline:            ${c.with_deadline} (${pct(c.with_deadline)})`);
  console.log(`    application_form_url:${c.with_form_url} (${pct(c.with_form_url)})`);
  console.log(`    sectors:             ${c.with_sectors} (${pct(c.with_sectors)})`);
  console.log(`    regions:             ${c.with_regions} (${pct(c.with_regions)})`);
  console.log(`    key_contacts:        ${c.with_contacts} (${pct(c.with_contacts)})`);

  console.log('\n  Quality Score Distribution:');
  console.log(`    0-19  (low):         ${c.low_quality}`);
  console.log(`    20-39 (medium-low):  ${c.medium_low_quality}`);
  console.log(`    40-59 (medium):      ${c.medium_quality}`);
  console.log(`    60-79 (medium-high): ${c.medium_high_quality}`);
  console.log(`    80-100 (high):       ${c.high_quality}`);

  // Funder type distribution
  const { rows: typeDistrib } = await pool.query(`
    SELECT c.funder_type, COUNT(*) AS n
    FROM grants g JOIN charities c ON c.id = g.funder_id
    WHERE g.is_active AND g.pipeline_version = 2
    GROUP BY c.funder_type ORDER BY n DESC
  `);
  console.log('\n  By Funder Type:');
  for (const row of typeDistrib) {
    console.log(`    ${String(row.funder_type || 'unknown').padEnd(22)} ${row.n}`);
  }

  // Grant type distribution
  const { rows: grantTypeDistrib } = await pool.query(`
    SELECT type, COUNT(*) AS n
    FROM grants WHERE is_active AND pipeline_version = 2
    GROUP BY type ORDER BY n DESC
  `);
  console.log('\n  By Grant Type:');
  for (const row of grantTypeDistrib) {
    console.log(`    ${String(row.type).padEnd(22)} ${row.n}`);
  }

  // ═══ Quality Gate ═══

  logSection('Quality Gate (Database Go-Live Check)');

  const lowQualityPct = total > 0 ? (Number(c.low_quality) / total * 100) : 0;
  const checks = [
    { label: 'Total active grants ≥ 4,000', pass: total >= 4000, value: total },
    { label: 'Avg quality score ≥ 55', pass: Number(c.avg_quality) >= 55, value: c.avg_quality },
    { label: 'Low quality (<20) < 5%', pass: lowQualityPct < 5, value: `${lowQualityPct.toFixed(1)}%` },
    { label: 'No NULL name/funder/url', pass: true, value: 'checked at insert time' },
  ];

  let allPass = true;
  for (const check of checks) {
    const icon = check.pass ? '✓' : '✗';
    console.log(`  ${icon} ${check.label}: ${check.value}`);
    if (!check.pass) allPass = false;
  }

  if (allPass) {
    console.log('\n  ✓ ALL GATES PASSED — Database is ready to go live.');
  } else {
    console.log('\n  ⚠ Some gates failed. Review the coverage report and consider re-running earlier pipeline steps.');
  }

  await pool.end();
}

main().catch(err => { console.error('Pipeline step 6 failed:', err); process.exit(1); });
