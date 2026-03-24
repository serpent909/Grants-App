/**
 * Import curated funder URLs from lib/markets/nz.ts into the charities table.
 *
 * Usage:
 *   DATABASE_URL="postgres://..." npx tsx scripts/import-curated-funders.ts
 *
 * Dedup strategy (three layers):
 *   1. URL normalisation — http→https, lowercase hostname, strip trailing slash.
 *      The stable CU-hash is computed from the *normalised* URL so near-duplicate
 *      URLs always resolve to the same row.
 *   2. Within-list dedup — if the same normalised URL appears twice in the curated
 *      list, the second occurrence is skipped with a warning.
 *   3. Cross-source dedup — if a funder appears only once in the curated list AND
 *      a register record already exists for that hostname, we update the existing
 *      row (add curated_grant_url + regions) instead of creating a duplicate.
 *      Multi-program funders (same hostname appears >1 times, e.g. communitymatters)
 *      are inserted as separate curated rows — one per grant page.
 *
 * Safe to re-run — merges are idempotent, inserts use ON CONFLICT.
 */

import { Pool } from '@neondatabase/serverless';
import { createHash } from 'crypto';
import { NZ_MARKET } from '../lib/markets/nz';

/** Normalise a URL: https, lowercase hostname, no trailing slash on path. */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.protocol = 'https:';
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/$/, '');
    return u.toString();
  } catch {
    return raw.trim();
  }
}

/** Extract bare hostname (no www) for cross-source matching. */
function bareHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Generate a stable 10-char charity_number from the *normalised* URL. */
function curatedCharityNumber(normalizedUrl: string): string {
  const hash = createHash('sha256').update(normalizedUrl).digest('hex');
  return 'CU' + hash.slice(0, 8).toUpperCase();
}

/** Derive a human-readable placeholder name from the URL domain. */
function nameFromUrl(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').split('.')[0];
    return h.charAt(0).toUpperCase() + h.slice(1);
  } catch {
    return url.slice(0, 50);
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) {
    console.error('Error: DATABASE_URL or POSTGRES_URL env var is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });

  // Ensure extended columns exist (migration 003 + enrichment columns)
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'register'`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS curated_grant_url TEXT`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS regions TEXT[]`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS grant_url TEXT`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS grant_summary TEXT`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMP`);

  // ── Layer 1 & 2: Normalise + deduplicate the curated list ──────────────────

  const rawEntries = NZ_MARKET.curatedFunderUrls;
  const seenNormUrls = new Map<string, string>(); // normUrl → original URL
  const entries: Array<{ normUrl: string; regions: string[] | null }> = [];
  let withinListDupes = 0;

  for (const entry of rawEntries) {
    const normUrl = normalizeUrl(entry.url);
    if (seenNormUrls.has(normUrl)) {
      console.warn(`  WARN duplicate URL in curated list (skipped): ${entry.url}`);
      console.warn(`       (same as: ${seenNormUrls.get(normUrl)})`);
      withinListDupes++;
    } else {
      seenNormUrls.set(normUrl, entry.url);
      entries.push({ normUrl, regions: entry.regions ?? null });
    }
  }

  console.log(`Curated list: ${rawEntries.length} raw → ${entries.length} after within-list dedup` +
    (withinListDupes > 0 ? ` (${withinListDupes} dupes removed)` : ''));

  // ── Layer 3: Cross-source dedup — load existing register records ───────────

  // Count how many curated entries share each bare hostname.
  // hostname count > 1 → multi-program funder → insert as new curated rows (can't merge N into 1).
  // hostname count = 1 → single-program → check if a register record already exists for it.
  const hostnameCount = new Map<string, number>();
  for (const e of entries) {
    const h = bareHostname(e.normUrl);
    hostnameCount.set(h, (hostnameCount.get(h) ?? 0) + 1);
  }

  type RegisterRow = { id: number; charity_number: string; website_url: string };
  const { rows: registerRows } = await pool.query<RegisterRow>(
    `SELECT id, charity_number, website_url
     FROM charities
     WHERE source = 'register' AND website_url IS NOT NULL`
  );

  // First match per hostname is sufficient; duplicate charity register entries for
  // the same website are rare and the first is the best candidate.
  const registerByHostname = new Map<string, { id: number; charity_number: string }>();
  for (const row of registerRows) {
    const h = bareHostname(row.website_url);
    if (h && !registerByHostname.has(h)) {
      registerByHostname.set(h, { id: row.id, charity_number: row.charity_number });
    }
  }
  console.log(`Loaded ${registerRows.length} register records for hostname matching\n`);

  // ── Process each curated entry ─────────────────────────────────────────────

  let mergedWithRegister = 0;
  let inserted = 0;
  let alreadyExisted = 0;
  // Track (curatedUrl → registerId) so orphan curated rows can be cleaned up safely.
  const mergedPairs: Array<{ curatedUrl: string; registerId: number }> = [];

  for (const entry of entries) {
    const h = bareHostname(entry.normUrl);
    const isSingleProgram = (hostnameCount.get(h) ?? 0) === 1;
    const registerMatch = isSingleProgram ? registerByHostname.get(h) : undefined;

    if (registerMatch) {
      // Update the existing register record rather than creating a duplicate row.
      await pool.query(
        `UPDATE charities
         SET curated_grant_url = $1,
             regions = $2
         WHERE id = $3`,
        [entry.normUrl, entry.regions, registerMatch.id]
      );
      mergedPairs.push({ curatedUrl: entry.normUrl, registerId: registerMatch.id });
      mergedWithRegister++;
      continue;
    }

    // No register match (or multi-program funder) — upsert as a curated row.
    const charityNumber = curatedCharityNumber(entry.normUrl);
    const name = nameFromUrl(entry.normUrl);

    const result = await pool.query(
      `INSERT INTO charities (charity_number, name, website_url, source, curated_grant_url, regions)
       VALUES ($1, $2, NULL, 'curated', $3, $4)
       ON CONFLICT (charity_number) DO UPDATE SET
         curated_grant_url = EXCLUDED.curated_grant_url,
         regions           = EXCLUDED.regions
       WHERE charities.source = 'curated'
       RETURNING (xmax = 0) AS is_insert`,
      [charityNumber, name, entry.normUrl, entry.regions]
    );

    if (result.rows[0]?.is_insert) inserted++;
    else alreadyExisted++;
  }

  // ── Clean up orphan curated rows that were merged into register records ────
  // A previous run of the old script may have inserted curated rows for funders
  // that now have a register record. For safety:
  //   1. Re-point any grants.funder_id references to the register record.
  //   2. Then delete the orphan curated row.
  let orphansDeleted = 0;
  for (const { curatedUrl, registerId } of mergedPairs) {
    const { rows: orphans } = await pool.query<{ id: number }>(
      `SELECT id FROM charities WHERE source = 'curated' AND curated_grant_url = $1`,
      [curatedUrl]
    );
    for (const orphan of orphans) {
      // Re-point any grants rows that reference the orphan curated row.
      await pool.query(
        `UPDATE grants SET funder_id = $1 WHERE funder_id = $2`,
        [registerId, orphan.id]
      );
      // Now safe to delete.
      await pool.query(
        `DELETE FROM charities WHERE id = $1 AND source = 'curated'`,
        [orphan.id]
      );
      orphansDeleted++;
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log('Results:');
  console.log(`  Merged into existing register records : ${mergedWithRegister}`);
  console.log(`  Inserted as new curated rows          : ${inserted}`);
  console.log(`  Already existed (no change)           : ${alreadyExisted}`);
  if (withinListDupes > 0) {
    console.log(`  Within-list duplicates skipped        : ${withinListDupes}`);
  }
  if (orphansDeleted > 0) {
    console.log(`  Orphan curated rows deleted           : ${orphansDeleted}`);
  }

  const { rows: totalRows } = await pool.query(
    `SELECT COUNT(*) AS total FROM charities WHERE source = 'curated'`
  );
  const { rows: mergedRows } = await pool.query(
    `SELECT COUNT(*) AS total FROM charities WHERE source = 'register' AND curated_grant_url IS NOT NULL`
  );
  console.log(`\nDB state after import:`);
  console.log(`  Curated rows (source='curated')                : ${totalRows[0].total}`);
  console.log(`  Register rows enriched with curated_grant_url  : ${mergedRows[0].total}`);
  console.log(`  Total funders with a curated grant URL         : ${Number(totalRows[0].total) + Number(mergedRows[0].total)}`);

  await pool.end();
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
