/**
 * Find and remove grants where the grant name is an organisation name rather than
 * a grant program name. Covers two patterns:
 *
 * Pattern A — name exactly matches a different charity in the DB
 *   e.g. funder="Ministry for the Environment", name="Community Trust South"
 *
 * Pattern B — name looks like a government dept / org name with no grant keywords
 *   e.g. funder="Rotorua Community Youth Centre Trust", name="Lottery Minister's Discretionary Fund"
 *        funder="Assistive Technology Alliance NZ Trust", name="Ministry of Health (MOH)"
 *
 * Exceptions (kept even if they match the pattern):
 *   - "Lottery Grants Board" funder: Lottery-prefixed names are legitimate program names
 *   - Kelliher funder names: their sub-program names include foundation names by design
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
  // Pattern A: name matches a different charity record
  const { rows: patternA } = await pool.query<{ id: string; funder_name: string; name: string; reason: string }>(`
    SELECT DISTINCT
      g.id,
      g.funder_name,
      g.name,
      'name matches charity "' || c.name || '"' AS reason
    FROM grants g
    JOIN charities c
      ON lower(trim(g.name)) = lower(trim(c.name))
     AND lower(trim(g.funder_name)) <> lower(trim(c.name))
    WHERE g.is_active = true
  `);

  // Pattern B: name looks like a govt dept / org name with no grant-type keywords,
  // excluding known-legitimate funder/name combinations.
  const { rows: patternB } = await pool.query<{ id: string; funder_name: string; name: string; reason: string }>(`
    SELECT
      id,
      funder_name,
      name,
      'org-style name with no grant keywords' AS reason
    FROM grants
    WHERE is_active = true
      -- Name looks like a government department
      AND (
        name ~* '^(Ministry|Department|Office|Commission|Authority|Agency|Bureau) of '
        OR name ~* '^Ministry for '
        OR name ~* 'Minister''s '
        OR (
          -- Ends with an org-type suffix and contains no grant-program keywords
          name ~* '(Trust|Foundation|Society|Incorporated|Board|Council|Authority|Commission)$'
          AND name !~* '(Grant|Fund|Scheme|Programme|Program|Award|Bursary|Scholarship|Fellowship|Initiative|Support|Subsidy|Allowance|Contribution)'
        )
      )
      -- Exclude known-legitimate cases
      AND funder_name NOT ILIKE '%Lottery Grants Board%'
      AND funder_name NOT ILIKE '%Kelliher%'
      -- Exclude self-referential grants that are legitimate (funder name appears in grant name)
      AND lower(name) NOT LIKE '%' || lower(split_part(funder_name, ' ', 1)) || '%'
  `);

  // Merge and deduplicate by id
  const seen = new Set<string>();
  const allRows: { id: string; funder_name: string; name: string; reason: string }[] = [];
  for (const row of [...patternA, ...patternB]) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      allRows.push(row);
    }
  }

  allRows.sort((a, b) => a.funder_name.localeCompare(b.funder_name) || a.name.localeCompare(b.name));

  if (allRows.length === 0) {
    console.log('No misnamed grants found.');
    await pool.end();
    return;
  }

  console.log(`Found ${allRows.length} misnamed grant(s):\n`);
  for (const row of allRows) {
    console.log(`  ${row.funder_name} → ${row.name}`);
    console.log(`  reason: ${row.reason}`);
    console.log(`  id: ${row.id}`);
    console.log();
  }

  if (!APPLY) {
    console.log('Dry run — pass --apply to delete these records.');
    await pool.end();
    return;
  }

  const ids = allRows.map(r => r.id);
  await pool.query(`DELETE FROM grants WHERE id = ANY($1::text[])`, [ids]);
  console.log(`Deleted ${ids.length} grant(s).`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
