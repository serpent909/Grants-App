/**
 * Pipeline Step 10: Admin utilities.
 *
 * Replaces: check-orphaned-ids.ts, clear-user-data.ts, analyse-scoring.ts
 *
 * Sub-commands:
 *   --check-orphans     Check for orphaned grant IDs in user tables
 *   --clear-user-data   Purge saved searches, shortlists, deep searches, applications
 *   --analyse-scoring   QA on search scoring accuracy
 *   --export-csv        Export active grants to CSV
 *   --archive-v1        Archive v1 (legacy) grants data
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/pipeline/10-admin-utils.ts --check-orphans
 *   DATABASE_URL="..." npx tsx scripts/pipeline/10-admin-utils.ts --clear-user-data
 *   DATABASE_URL="..." npx tsx scripts/pipeline/10-admin-utils.ts --export-csv
 *   DATABASE_URL="..." npx tsx scripts/pipeline/10-admin-utils.ts --archive-v1
 */

import { createPool, hasFlag, logSection } from '../../lib/pipeline/runner';
import { writeFileSync } from 'fs';

async function checkOrphans() {
  const pool = createPool();
  logSection('Check Orphaned Grant IDs');

  const tables = [
    { name: 'saved_searches', idField: 'result_json', isJsonb: true },
    { name: 'shortlisted_grants', idField: 'grant_id', isJsonb: false },
    { name: 'deep_searches', idField: 'grant_id', isJsonb: false },
    { name: 'grant_applications', idField: 'grant_id', isJsonb: false },
  ];

  for (const table of tables) {
    if (table.isJsonb) {
      // For saved_searches, grant IDs are embedded in result_json
      const { rows } = await pool.query(`
        SELECT s.id, jsonb_array_elements(s.result_json->'grants')->>'id' AS grant_id
        FROM ${table.name} s
      `);
      const orphans = [];
      for (const row of rows) {
        const { rows: exists } = await pool.query(
          `SELECT 1 FROM grants WHERE id = $1`, [row.grant_id]
        );
        if (exists.length === 0) orphans.push({ searchId: row.id, grantId: row.grant_id });
      }
      console.log(`  ${table.name}: ${orphans.length} orphaned references`);
      if (orphans.length > 0 && orphans.length <= 20) {
        for (const o of orphans) console.log(`    search ${o.searchId} → grant ${o.grantId}`);
      }
    } else {
      const { rows } = await pool.query(`
        SELECT t.grant_id
        FROM ${table.name} t
        LEFT JOIN grants g ON g.id = t.grant_id
        WHERE g.id IS NULL
      `);
      console.log(`  ${table.name}: ${rows.length} orphaned references`);
      if (rows.length > 0 && rows.length <= 20) {
        for (const r of rows) console.log(`    → ${r.grant_id}`);
      }
    }
  }

  await pool.end();
}

async function clearUserData() {
  const pool = createPool();
  logSection('Clear User Data');

  const tables = ['checklist_documents', 'application_checklist_items', 'grant_applications',
                  'deep_searches', 'shortlisted_grants', 'saved_searches'];

  for (const table of tables) {
    const { rowCount } = await pool.query(`DELETE FROM ${table}`);
    console.log(`  ${table}: ${rowCount} rows deleted`);
  }

  console.log('\n  Done. All user session data cleared.');
  await pool.end();
}

async function analyseScoring() {
  const pool = createPool();
  logSection('Scoring Analysis');

  // Get most recent saved search
  const { rows: searches } = await pool.query(`
    SELECT id, name, result_json, saved_at
    FROM saved_searches ORDER BY saved_at DESC LIMIT 1
  `);

  if (searches.length === 0) {
    console.log('  No saved searches found.');
    await pool.end();
    return;
  }

  const search = searches[0];
  const result = search.result_json;
  const grants = result.grants || [];

  console.log(`  Analysing: "${search.name}" (${grants.length} grants, saved ${search.saved_at})`);

  // Check for scoring anomalies
  let highAlignmentNoDesc = 0;
  let suspiciousScores = 0;

  for (const grant of grants) {
    const scores = grant.scores;
    if (!scores) continue;

    // High alignment but no description in DB
    const { rows } = await pool.query<{ description: string | null; data_quality_score: number | null }>(
      `SELECT description, data_quality_score FROM grants WHERE id = $1`, [grant.id]
    );
    if (rows.length > 0) {
      if (scores.alignment >= 8 && !rows[0].description) {
        highAlignmentNoDesc++;
        console.log(`    ⚠ High alignment (${scores.alignment}) but no description: ${grant.name}`);
      }
      if (scores.overall >= 8 && rows[0].data_quality_score != null && rows[0].data_quality_score < 30) {
        suspiciousScores++;
        console.log(`    ⚠ High score (${scores.overall}) but low data quality (${rows[0].data_quality_score}): ${grant.name}`);
      }
    }
  }

  console.log(`\n  Summary:`);
  console.log(`    High alignment, no description: ${highAlignmentNoDesc}`);
  console.log(`    Suspicious score + low quality: ${suspiciousScores}`);

  await pool.end();
}

async function exportCsv() {
  const pool = createPool();
  logSection('Export Grants to CSV');

  const { rows } = await pool.query(`
    SELECT g.id, g.name, g.funder_name, c.funder_type, g.type, g.description,
           g.url, g.amount_min, g.amount_max,
           array_to_string(g.regions, ';') AS regions,
           array_to_string(g.sectors, ';') AS sectors,
           array_to_string(g.eligibility, ' | ') AS eligibility,
           g.deadline, g.is_recurring, g.round_frequency,
           g.application_form_url, g.data_quality_score, g.pipeline_version
    FROM grants g
    LEFT JOIN charities c ON c.id = g.funder_id
    WHERE g.is_active AND g.pipeline_version = 2
    ORDER BY g.funder_name, g.name
  `);

  const headers = Object.keys(rows[0] || {}).join(',');
  const csvRows = rows.map(r =>
    Object.values(r).map(v => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );

  const csv = [headers, ...csvRows].join('\n');
  const filename = `grants-export-${new Date().toISOString().slice(0, 10)}.csv`;
  writeFileSync(filename, csv, 'utf-8');
  console.log(`  Exported ${rows.length} grants to ${filename}`);

  await pool.end();
}

async function archiveV1() {
  const pool = createPool();
  logSection('Archive V1 (Legacy) Data');

  const { rows: v1Count } = await pool.query(
    `SELECT COUNT(*)::text AS n FROM grants WHERE pipeline_version = 1 OR pipeline_version IS NULL`
  );
  console.log(`  V1 grants to archive: ${v1Count[0].n}`);

  if (Number(v1Count[0].n) === 0) {
    console.log('  Nothing to archive.');
    await pool.end();
    return;
  }

  // Ensure v2 has enough data before archiving
  const { rows: v2Count } = await pool.query(
    `SELECT COUNT(*)::text AS n FROM grants WHERE is_active AND pipeline_version = 2`
  );
  if (Number(v2Count[0].n) < 3000) {
    console.log(`  ⚠ Only ${v2Count[0].n} v2 grants active. Archive aborted — need at least 3,000.`);
    await pool.end();
    return;
  }

  // Delete v1 grants
  const { rowCount } = await pool.query(
    `DELETE FROM grants WHERE pipeline_version = 1 OR pipeline_version IS NULL`
  );
  console.log(`  Deleted ${rowCount} v1 grants.`);

  // Remove pipeline_version filter from queries (no longer needed)
  console.log('  ✓ V1 data archived. You can now remove the pipeline_version filter from searchGrants().');

  await pool.end();
}

// ─── Router ─────────────────────────────────────────────────────────────────

async function main() {
  if (hasFlag('--check-orphans')) return checkOrphans();
  if (hasFlag('--clear-user-data')) return clearUserData();
  if (hasFlag('--analyse-scoring')) return analyseScoring();
  if (hasFlag('--export-csv')) return exportCsv();
  if (hasFlag('--archive-v1')) return archiveV1();

  console.log('Usage: npx tsx scripts/pipeline/10-admin-utils.ts <command>');
  console.log('');
  console.log('Commands:');
  console.log('  --check-orphans     Check for orphaned grant IDs in user tables');
  console.log('  --clear-user-data   Purge all user session data');
  console.log('  --analyse-scoring   QA on search scoring accuracy');
  console.log('  --export-csv        Export active grants to CSV');
  console.log('  --archive-v1        Delete legacy v1 grants (after v2 validated)');
}

main().catch(err => { console.error('Admin utils failed:', err); process.exit(1); });
