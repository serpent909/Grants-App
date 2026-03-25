/**
 * Find and remove duplicate grants in the DB.
 *
 * Duplicates are grants from the same funder with very similar names.
 * Keeps the row with the most complete data (most non-null fields).
 *
 * Usage:
 *   npx tsx scripts/dedup-grants.ts            # dry run — shows duplicates
 *   npx tsx scripts/dedup-grants.ts --apply     # actually deletes duplicates
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }

const pool = new Pool({ connectionString: url });
const APPLY = process.argv.includes('--apply');

// ─── String similarity (Dice coefficient on bigrams) ─────────────────────────

function bigrams(s: string): Set<string> {
  const bg = new Set<string>();
  const lower = s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  for (let i = 0; i < lower.length - 1; i++) {
    bg.add(lower.slice(i, i + 2));
  }
  return bg;
}

function similarity(a: string, b: string): number {
  const bgA = bigrams(a);
  const bgB = bigrams(b);
  if (bgA.size === 0 && bgB.size === 0) return 1;
  if (bgA.size === 0 || bgB.size === 0) return 0;
  let intersection = 0;
  for (const bg of bgA) {
    if (bgB.has(bg)) intersection++;
  }
  return (2 * intersection) / (bgA.size + bgB.size);
}

// ─── Completeness score (how many useful fields are populated) ───────────────

interface Grant {
  id: string;
  funder_id: number;
  funder_name: string;
  name: string;
  description: string | null;
  url: string;
  regions: string[] | null;
  sectors: string[] | null;
  eligibility: string[] | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  application_form_url: string | null;
  source_url: string | null;
  is_active: boolean;
}

function completeness(g: Grant): number {
  let score = 0;
  if (g.description) score += 3; // description is most valuable
  if (g.sectors?.length) score += 2;
  if (g.regions?.length) score += 1;
  if (g.eligibility?.length) score += 2;
  if (g.amount_min != null) score += 1;
  if (g.amount_max != null) score += 1;
  if (g.deadline) score += 1;
  if (g.application_form_url) score += 1;
  if (g.source_url) score += 1;
  // Prefer longer descriptions
  if (g.description && g.description.length > 100) score += 1;
  return score;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Fetch all active grants grouped by funder
  const { rows: grants } = await pool.query<Grant>(`
    SELECT id, funder_id, funder_name, name, description, url,
           regions, sectors, eligibility, amount_min, amount_max,
           deadline, application_form_url, source_url, is_active
    FROM grants
    WHERE is_active = true
    ORDER BY funder_id, name
  `);

  console.log(`Total active grants: ${grants.length}`);

  // Group by funder_id
  const byFunder = new Map<number, Grant[]>();
  for (const g of grants) {
    if (!g.funder_id) continue;
    const arr = byFunder.get(g.funder_id) || [];
    arr.push(g);
    byFunder.set(g.funder_id, arr);
  }

  const NAME_THRESHOLD = 0.85;
  const dupGroups: { keep: Grant; remove: Grant[] }[] = [];
  let totalToRemove = 0;

  for (const [_funderId, funderGrants] of byFunder) {
    if (funderGrants.length < 2) continue;

    // Find pairs of similar names within this funder (no transitive clustering)
    // Each grant can only be in one group — anchored to the first match
    const visited = new Set<string>();

    for (let i = 0; i < funderGrants.length; i++) {
      if (visited.has(funderGrants[i].id)) continue;

      const cluster: Grant[] = [funderGrants[i]];
      visited.add(funderGrants[i].id);

      // Only compare against the anchor grant (funderGrants[i]), no transitive expansion
      for (let j = i + 1; j < funderGrants.length; j++) {
        if (visited.has(funderGrants[j].id)) continue;

        const nameSim = similarity(funderGrants[i].name, funderGrants[j].name);
        if (nameSim < NAME_THRESHOLD) continue;

        // For borderline matches (0.80–0.90), also check description similarity
        if (nameSim < 0.90) {
          const descA = funderGrants[i].description || '';
          const descB = funderGrants[j].description || '';
          // If both have descriptions but they're very different, skip
          if (descA.length > 30 && descB.length > 30 && similarity(descA, descB) < 0.4) continue;
        }

        cluster.push(funderGrants[j]);
        visited.add(funderGrants[j].id);
      }

      if (cluster.length > 1) {
        // Sort by completeness descending — keep the best one
        cluster.sort((a, b) => completeness(b) - completeness(a));
        const keep = cluster[0];
        const remove = cluster.slice(1);
        dupGroups.push({ keep, remove });
        totalToRemove += remove.length;
      }
    }
  }

  // Report
  console.log(`\nFound ${dupGroups.length} duplicate groups, ${totalToRemove} grants to remove\n`);

  for (const { keep, remove } of dupGroups) {
    console.log('─'.repeat(70));
    console.log(`FUNDER: ${keep.funder_name}`);
    console.log(`  KEEP:   [${completeness(keep).toString().padStart(2)}] "${keep.name}" (${keep.id})`);
    if (keep.sectors?.length) console.log(`          sectors: ${keep.sectors.join(', ')}`);
    if (keep.description) console.log(`          desc: ${keep.description.slice(0, 80)}...`);
    for (const r of remove) {
      console.log(`  REMOVE: [${completeness(r).toString().padStart(2)}] "${r.name}" (${r.id})`);
      const sim = similarity(keep.name, r.name);
      console.log(`          similarity: ${(sim * 100).toFixed(0)}% | sectors: ${(r.sectors || []).join(', ') || '(none)'}`);
    }
  }

  if (APPLY && totalToRemove > 0) {
    const idsToRemove = dupGroups.flatMap(g => g.remove.map(r => r.id));
    console.log(`\nDeleting ${idsToRemove.length} duplicate grants...`);

    // Soft-delete: mark as inactive rather than hard delete
    const { rowCount } = await pool.query(
      `UPDATE grants SET is_active = false, scrape_notes = 'dedup: duplicate removed' WHERE id = ANY($1)`,
      [idsToRemove],
    );
    console.log(`Done — ${rowCount} grants deactivated.`);
  } else if (!APPLY && totalToRemove > 0) {
    console.log(`\nDry run complete. Run with --apply to deactivate ${totalToRemove} duplicates.`);
  } else {
    console.log('\nNo duplicates found.');
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
