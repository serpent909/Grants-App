/**
 * Deactivate grants with past deadlines.
 *
 * Usage:
 *   npx tsx scripts/deactivate-expired.ts            # dry run
 *   npx tsx scripts/deactivate-expired.ts --apply     # deactivate them
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }

const pool = new Pool({ connectionString: url });
const APPLY = process.argv.includes('--apply');

async function main() {
  const { rows } = await pool.query(`
    SELECT g.id, g.name, c.name as funder, g.deadline
    FROM grants g
    JOIN charities c ON c.id = g.funder_id
    WHERE g.is_active
      AND g.deadline IS NOT NULL
      AND g.deadline ~ '^\\d{4}-\\d{2}-\\d{2}'
      AND g.deadline::date < CURRENT_DATE
    ORDER BY g.deadline
  `);

  console.log(`Found ${rows.length} active grants with past deadlines:`);
  for (const r of rows) {
    console.log(`  ${r.deadline.slice(0, 10)}  ${r.name.slice(0, 50).padEnd(50)}  ${r.funder.slice(0, 30)}`);
  }

  if (APPLY && rows.length > 0) {
    const ids = rows.map((r: { id: string }) => r.id);
    const { rowCount } = await pool.query(
      `UPDATE grants SET is_active = false, scrape_notes = 'expired: deadline passed' WHERE id = ANY($1)`,
      [ids],
    );
    console.log(`\nDeactivated ${rowCount} expired grants.`);
  } else if (!APPLY && rows.length > 0) {
    console.log(`\nDry run. Run with --apply to deactivate ${rows.length} grants.`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
