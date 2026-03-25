/**
 * Reports field coverage for active grants and funder classification.
 * Run before and after each enrichment phase to measure progress.
 *
 * Usage:
 *   npx tsx scripts/coverage-report.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }

const pool = new Pool({ connectionString: url });

async function main() {
  const { rows: [{ n: total }] } = await pool.query(
    `SELECT COUNT(*) AS n FROM grants WHERE is_active`
  );

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║          ACTIVE GRANTS COVERAGE REPORT              ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\nTotal active grants: ${total}\n`);

  const fields: [string, string][] = [
    ['description', `description IS NOT NULL AND description != ''`],
    ['sectors[]', `sectors IS NOT NULL AND array_length(sectors, 1) > 0`],
    ['eligibility[]', `eligibility IS NOT NULL AND array_length(eligibility, 1) > 0`],
    ['regions[]', `regions IS NOT NULL AND array_length(regions, 1) > 0`],
    ['amount_min', `amount_min IS NOT NULL`],
    ['amount_max', `amount_max IS NOT NULL`],
    ['deadline', `deadline IS NOT NULL AND deadline != ''`],
    ['application_form_url', `application_form_url IS NOT NULL`],
    ['is_recurring', `is_recurring IS NOT NULL`],
    ['round_frequency', `round_frequency IS NOT NULL`],
    ['key_contacts', `key_contacts IS NOT NULL AND key_contacts != ''`],
    ['source_url', `source_url IS NOT NULL`],
  ];

  console.log('  Field                      Coverage');
  console.log('  ' + '─'.repeat(50));

  for (const [name, cond] of fields) {
    const { rows: [{ n }] } = await pool.query(
      `SELECT COUNT(*) AS n FROM grants WHERE is_active AND ${cond}`
    );
    const pct = ((n / total) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(n / total * 30)) + '░'.repeat(30 - Math.round(n / total * 30));
    console.log(`  ${name.padEnd(25)} ${pct.padStart(5)}%  ${bar}  ${n}/${total}`);
  }

  // Funder type breakdown for funders with active grants
  console.log('\n\n╔══════════════════════════════════════════════════════╗');
  console.log('║          FUNDER TYPE COVERAGE                       ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const { rows: ftRows } = await pool.query(`
    SELECT COALESCE(c.funder_type, 'NULL') AS funder_type, COUNT(DISTINCT c.id) AS funders, COUNT(g.id) AS grants
    FROM charities c
    JOIN grants g ON g.funder_id = c.id AND g.is_active
    GROUP BY c.funder_type
    ORDER BY grants DESC
  `);

  let classifiedFunders = 0, unclassifiedFunders = 0;
  let classifiedGrants = 0, unclassifiedGrants = 0;

  console.log('  Type                    Funders   Grants');
  console.log('  ' + '─'.repeat(50));
  for (const r of ftRows) {
    const ft = r.funder_type;
    console.log(`  ${ft.padEnd(25)} ${String(r.funders).padStart(5)}    ${String(r.grants).padStart(5)}`);
    if (ft !== 'other' && ft !== 'NULL') {
      classifiedFunders += parseInt(r.funders);
      classifiedGrants += parseInt(r.grants);
    } else {
      unclassifiedFunders += parseInt(r.funders);
      unclassifiedGrants += parseInt(r.grants);
    }
  }

  console.log('  ' + '─'.repeat(50));
  console.log(`  Classified:              ${String(classifiedFunders).padStart(5)}    ${String(classifiedGrants).padStart(5)}`);
  console.log(`  Unclassified (other/NULL): ${String(unclassifiedFunders).padStart(3)}    ${String(unclassifiedGrants).padStart(5)}`);

  // Grant type breakdown
  console.log('\n\n╔══════════════════════════════════════════════════════╗');
  console.log('║          GRANT TYPE BREAKDOWN                       ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const { rows: typeRows } = await pool.query(`
    SELECT type, COUNT(*) AS n FROM grants WHERE is_active GROUP BY type ORDER BY n DESC
  `);
  for (const r of typeRows) {
    console.log(`  ${r.type.padEnd(25)} ${r.n}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
