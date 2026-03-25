/**
 * Fix orphaned grant IDs in saved_searches, shortlisted_grants,
 * deep_searches, and grant_applications.
 *
 * The old search code generated IDs from the model's (potentially rewritten)
 * name/funder/url. This script matches orphaned grants back to the DB
 * by funder name + grant name similarity, then rewrites the IDs.
 *
 * Usage:
 *   npx tsx scripts/fix-orphaned-ids.ts            # dry run
 *   npx tsx scripts/fix-orphaned-ids.ts --apply     # fix them
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }

const pool = new Pool({ connectionString: url });
const APPLY = process.argv.includes('--apply');

// Simple normalisation for matching
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

interface DbGrant {
  id: string;
  name: string;
  funder_name: string;
  url: string;
}

async function main() {
  // Load all grants from DB (including inactive, in case they were deactivated after being saved)
  const { rows: dbGrants } = await pool.query<DbGrant>(
    `SELECT g.id, g.name, c.name as funder_name, g.url FROM grants g JOIN charities c ON c.id = g.funder_id`
  );

  // Build lookup indices
  const byId = new Map(dbGrants.map(g => [g.id, g]));
  // Group by normalised funder name for fast lookup
  const byFunder = new Map<string, DbGrant[]>();
  for (const g of dbGrants) {
    const key = norm(g.funder_name);
    const arr = byFunder.get(key) || [];
    arr.push(g);
    byFunder.set(key, arr);
  }

  function findMatch(badId: string, name: string, funder: string, grantUrl?: string): DbGrant | null {
    // Already valid?
    if (byId.has(badId)) return null;

    // Try exact funder match first
    const normFunder = norm(funder);
    const candidates = byFunder.get(normFunder) || [];

    // Try exact name match within funder
    const normName = norm(name);
    const exact = candidates.find(c => norm(c.name) === normName);
    if (exact) return exact;

    // Try URL match
    if (grantUrl) {
      const normUrl = grantUrl.toLowerCase().split('?')[0].split('#')[0];
      const urlMatch = candidates.find(c => c.url.toLowerCase().split('?')[0].split('#')[0] === normUrl);
      if (urlMatch) return urlMatch;
    }

    // Try fuzzy name match (contains or is contained)
    const fuzzy = candidates.find(c => {
      const cn = norm(c.name);
      return cn.includes(normName) || normName.includes(cn);
    });
    if (fuzzy) return fuzzy;

    return null;
  }

  let totalFixed = 0;
  let totalUnfixable = 0;

  // ─── Fix saved_searches ────────────────────────────────────────────────────
  console.log('=== SAVED SEARCHES ===');
  const { rows: searches } = await pool.query('SELECT id, name, result_json FROM saved_searches');

  for (const search of searches) {
    const grants = search.result_json?.grants || [];
    let fixed = 0, unfixable = 0;

    for (const g of grants) {
      if (byId.has(g.id)) continue; // already valid

      const match = findMatch(g.id, g.name, g.funder, g.url);
      if (match) {
        if (!APPLY) {
          // Just count in dry run
        }
        g.id = match.id;
        g.name = match.name;         // Also fix the name back to DB version
        g.funder = match.funder_name; // And funder
        g.url = match.url;           // And URL
        fixed++;
      } else {
        unfixable++;
      }
    }

    if (fixed > 0 || unfixable > 0) {
      console.log(`  "${search.name}": ${fixed} fixed, ${unfixable} unfixable`);
    }

    if (APPLY && fixed > 0) {
      await pool.query(
        'UPDATE saved_searches SET result_json = $1 WHERE id = $2',
        [JSON.stringify(search.result_json), search.id],
      );
    }

    totalFixed += fixed;
    totalUnfixable += unfixable;
  }

  // ─── Fix shortlisted_grants ────────────────────────────────────────────────
  console.log('\n=== SHORTLISTED GRANTS ===');
  const { rows: shortlisted } = await pool.query(
    `SELECT org_id, grant_id, grant_json FROM shortlisted_grants WHERE grant_id NOT IN (SELECT id FROM grants)`
  );

  for (const sl of shortlisted) {
    const g = sl.grant_json;
    const match = findMatch(sl.grant_id, g?.name || '', g?.funder || '', g?.url);
    if (match) {
      console.log(`  FIXED: "${g?.name}" → ${match.id} (${match.name})`);
      if (APPLY) {
        g.id = match.id;
        g.name = match.name;
        g.funder = match.funder_name;
        g.url = match.url;
        await pool.query(
          `UPDATE shortlisted_grants SET grant_id = $1, grant_json = $2 WHERE org_id = $3 AND grant_id = $4`,
          [match.id, JSON.stringify(g), sl.org_id, sl.grant_id],
        );
      }
      totalFixed++;
    } else {
      console.log(`  UNFIXABLE: "${g?.name}" by ${g?.funder} (${sl.grant_id})`);
      totalUnfixable++;
    }
  }

  // ─── Fix deep_searches ─────────────────────────────────────────────────────
  console.log('\n=== DEEP SEARCHES ===');
  const { rows: deepSearches } = await pool.query(
    `SELECT org_id, grant_id, result_json FROM deep_searches WHERE grant_id NOT IN (SELECT id FROM grants)`
  );

  for (const ds of deepSearches) {
    const r = ds.result_json;
    const match = findMatch(ds.grant_id, r?.grantName || '', r?.funder || '', r?.grantUrl);
    if (match) {
      console.log(`  FIXED: "${r?.grantName}" → ${match.id} (${match.name})`);
      if (APPLY) {
        r.grantId = match.id;
        r.grantName = match.name;
        r.funder = match.funder_name;
        r.grantUrl = match.url;
        await pool.query(
          `UPDATE deep_searches SET grant_id = $1, result_json = $2 WHERE org_id = $3 AND grant_id = $4`,
          [match.id, JSON.stringify(r), ds.org_id, ds.grant_id],
        );
      }
      totalFixed++;
    } else {
      console.log(`  UNFIXABLE: "${r?.grantName}" by ${r?.funder} (${ds.grant_id})`);
      totalUnfixable++;
    }
  }

  // ─── Fix grant_applications ────────────────────────────────────────────────
  console.log('\n=== GRANT APPLICATIONS ===');
  const { rows: applications } = await pool.query(
    `SELECT org_id, grant_id, id, grant_json FROM grant_applications WHERE grant_id NOT IN (SELECT id FROM grants)`
  );

  for (const app of applications) {
    const g = app.grant_json;
    const match = findMatch(app.grant_id, g?.name || '', g?.funder || '', g?.url);
    if (match) {
      console.log(`  FIXED: "${g?.name}" → ${match.id} (${match.name})`);
      if (APPLY) {
        g.id = match.id;
        g.name = match.name;
        g.funder = match.funder_name;
        g.url = match.url;
        await pool.query(
          `UPDATE grant_applications SET grant_id = $1, grant_json = $2 WHERE org_id = $3 AND grant_id = $4`,
          [match.id, JSON.stringify(g), app.org_id, app.grant_id],
        );
      }
      totalFixed++;
    } else {
      console.log(`  UNFIXABLE: "${g?.name}" by ${g?.funder} (${app.grant_id})`);
      totalUnfixable++;
    }
  }

  console.log(`\nTotal: ${totalFixed} fixable, ${totalUnfixable} unfixable`);
  if (!APPLY && totalFixed > 0) {
    console.log(`Dry run. Run with --apply to fix ${totalFixed} references.`);
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
