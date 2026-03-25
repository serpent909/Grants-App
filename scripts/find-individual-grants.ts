/**
 * Find grants in the DB that appear to be for individual applicants
 * (scholarships, bursaries, fellowships, personal development grants)
 * rather than for organisations.
 *
 * Usage:
 *   npx tsx scripts/find-individual-grants.ts            # dry run
 *   npx tsx scripts/find-individual-grants.ts --apply     # deactivate them
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }

const pool = new Pool({ connectionString: url });
const APPLY = process.argv.includes('--apply');

// Eligibility phrases that indicate the grant IS for organisations (exclude these)
const ORG_ELIGIBILITY_PATTERNS = [
  'registered charit', 'charitable trust', 'incorporated societ',
  'community group', 'community organi', 'not-for-profit', 'non-profit',
  'ngo', 'organisation', 'organization', 'club', 'society',
  'marae', 'hapū', 'iwi organi',
];

function looksLikeOrgGrant(eligibility: string[] | null): boolean {
  if (!eligibility?.length) return false;
  const joined = eligibility.join(' ').toLowerCase();
  return ORG_ELIGIBILITY_PATTERNS.some(p => joined.includes(p));
}

async function main() {
  // Pattern 1: Name contains scholarship/bursary/fellowship/residency keywords
  // EXCLUDE grants whose eligibility indicates they're for organisations
  const { rows: byName } = await pool.query(`
    SELECT g.id, g.name, c.name as funder, g.description, g.eligibility
    FROM grants g
    JOIN charities c ON c.id = g.funder_id
    WHERE g.is_active
      AND LOWER(g.name) ~ '(scholarship|bursary|bursaries|fellowship|residency|apprenticeship|internship)'
    ORDER BY g.name
  `);

  // Filter out grants that mention org eligibility (charities, trusts, etc.)
  const byNameFiltered = byName.filter(r => !looksLikeOrgGrant(r.eligibility));
  const byNameExcluded = byName.length - byNameFiltered.length;

  // Pattern 2: Eligibility clearly indicates individual applicants
  // Use tight patterns — avoid "must be a resident/citizen" (too broad, catches org location requirements)
  const foundIds = byNameFiltered.map(r => r.id);
  const { rows: byEligibility } = await pool.query(`
    SELECT g.id, g.name, c.name as funder, g.description, g.eligibility
    FROM grants g
    JOIN charities c ON c.id = g.funder_id
    WHERE g.is_active
      AND g.eligibility IS NOT NULL
      AND (
        LOWER(array_to_string(g.eligibility, ' ')) ~ '(must be a student|must be an individual|individual applicant|must be enrolled in.*(study|course|program|degree)|must be aged [0-9]|under the age of [0-9]|must be a young (person|mum|mother|artist|leader|adult)|for individuals|must be a (boy|girl|woman|man|athlete|coach|teacher|doctor|nurse|researcher|singer|musician|artist|writer|tenor|pianist))'
      )
      AND g.id NOT IN (SELECT unnest($1::text[]))
    ORDER BY g.name
  `, [foundIds]);

  // Also filter out org-eligible grants from this group
  const byEligFiltered = byEligibility.filter(r => !looksLikeOrgGrant(r.eligibility));
  const byEligExcluded = byEligibility.length - byEligFiltered.length;

  // Pattern 3: Description indicates individual-only grants
  const alreadyFound = [...byNameFiltered, ...byEligFiltered].map(r => r.id);
  const { rows: byDesc } = await pool.query(`
    SELECT g.id, g.name, c.name as funder, g.description, g.eligibility
    FROM grants g
    JOIN charities c ON c.id = g.funder_id
    WHERE g.is_active
      AND g.description IS NOT NULL
      AND LOWER(g.description) ~ '(for individual artists|for individual applicants|personal development grant|scholarships? (is |are )?(available |offered )?(to|for) (students|individuals)|award is for (a |an )?(new zealand )?(individual|student|person|graduate|researcher|artist|writer|musician)|this (scholarship|bursary|fellowship|award) (is |supports |provides ).*(student|individual|person))'
      AND g.id NOT IN (SELECT unnest($1::text[]))
    ORDER BY g.name
  `, [alreadyFound]);

  const byDescFiltered = byDesc.filter(r => !looksLikeOrgGrant(r.eligibility));

  const allMatches = [...byNameFiltered, ...byEligFiltered, ...byDescFiltered];

  console.log(`Found ${allMatches.length} grants for individuals (to deactivate):`);
  console.log(`  ${byNameFiltered.length} matched by name (${byNameExcluded} excluded as org-eligible)`);
  console.log(`  ${byEligFiltered.length} matched by eligibility (${byEligExcluded} excluded as org-eligible)`);
  console.log(`  ${byDescFiltered.length} matched by description`);
  console.log('');

  for (const r of allMatches) {
    console.log(`  ${r.name.slice(0, 60).padEnd(60)} | ${r.funder.slice(0, 40)}`);
    if (r.eligibility?.length) {
      console.log(`    elig: ${r.eligibility.join('; ').slice(0, 120)}`);
    }
  }

  if (APPLY && allMatches.length > 0) {
    const ids = allMatches.map(r => r.id);
    const { rowCount } = await pool.query(
      `UPDATE grants SET is_active = false, scrape_notes = 'individual-only: not for organisations' WHERE id = ANY($1)`,
      [ids],
    );
    console.log(`\nDeactivated ${rowCount} individual-applicant grants.`);
  } else if (!APPLY && allMatches.length > 0) {
    console.log(`\nDry run. Run with --apply to deactivate ${allMatches.length} grants.`);
  }

  // Show active grant count
  const { rows: [count] } = await pool.query('SELECT count(*) as n FROM grants WHERE is_active');
  console.log(`\nActive grants remaining: ${count.n}`);

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
