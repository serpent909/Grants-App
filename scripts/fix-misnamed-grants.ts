/**
 * Find and remove grants where the grant `name` matches a known funder/charity name.
 * This catches records produced by the Playwright enrichment script where GPT used
 * a co-funder or partner org name (mentioned on the page) as the grant program name.
 *
 * Usage:
 *   npx tsx scripts/fix-misnamed-grants.ts           # dry run — lists bad records
 *   npx tsx scripts/fix-misnamed-grants.ts --apply   # deletes them
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }

const pool = new Pool({ connectionString: url });
const APPLY = process.argv.includes('--apply');

async function main() {
  // Find grants whose name closely matches a charity/funder name that is NOT
  // the grant's own funder. These are cases where GPT extracted a co-funder
  // name from the page content and used it as the grant program name.
  const { rows } = await pool.query<{
    grant_id: string;
    grant_name: string;
    funder_name: string;
    matched_charity: string;
  }>(`
    SELECT
      g.id        AS grant_id,
      g.name      AS grant_name,
      g.funder_name,
      c.name      AS matched_charity
    FROM grants g
    JOIN charities c
      ON lower(trim(g.name)) = lower(trim(c.name))
     AND lower(trim(g.funder_name)) <> lower(trim(c.name))
    WHERE g.is_active = true
    ORDER BY g.funder_name, g.name
  `);

  if (rows.length === 0) {
    console.log('No misnamed grants found.');
    await pool.end();
    return;
  }

  console.log(`Found ${rows.length} grant(s) where grant name matches a different funder:\n`);
  for (const row of rows) {
    console.log(`  funder_name : ${row.funder_name}`);
    console.log(`  grant name  : ${row.grant_name}  ← matches charity "${row.matched_charity}"`);
    console.log(`  grant id    : ${row.grant_id}`);
    console.log();
  }

  if (!APPLY) {
    console.log('Dry run — pass --apply to delete these records.');
    await pool.end();
    return;
  }

  const ids = rows.map(r => r.grant_id);
  await pool.query(`DELETE FROM grants WHERE id = ANY($1::text[])`, [ids]);
  console.log(`Deleted ${ids.length} grant(s).`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
