/**
 * Pipeline Step 4: Deduplication and data cleaning.
 *
 * Replaces: dedup-grants.ts, audit-false-splits.ts, verify-false-splits.ts,
 *           fix-misnamed-grants.ts, find-individual-grants.ts
 *
 * Runs BEFORE gap-filling to avoid wasting API calls on records that will be removed.
 *
 * Passes:
 *   1. Exact dedup (same funder, same source_url, near-identical names)
 *   2. Name similarity dedup (same funder, high name similarity)
 *   3. False-split audit (GPT classification of multi-grant same-URL groups)
 *   4. Misnamed grants (grant name matches charity name)
 *   5. Historical round listings ("Successful Grants June 2023")
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/pipeline/04-dedup-and-clean.ts          # dry run
 *   DATABASE_URL="..." OPENAI_API_KEY="..." npx tsx scripts/pipeline/04-dedup-and-clean.ts --apply
 */

import {
  createPool, hasFlag, logSection, logSummary,
} from '../../lib/pipeline/runner';
import {
  similarity, completeness, type GrantForDedup,
} from '../../lib/pipeline/quality';
import { classifyFalseSplits, type FalseSplitGroup } from '../../lib/pipeline/extractor';

const APPLY = hasFlag('--apply');

async function main() {
  const pool = createPool();

  const { rows: initialCount } = await pool.query(
    `SELECT COUNT(*)::text AS count FROM grants WHERE is_active AND pipeline_version = 2`
  );
  const startCount = Number(initialCount[0].count);
  console.log(`Starting with ${startCount} active v2 grants`);

  let pass1Removed = 0, pass2Removed = 0, pass3Removed = 0, pass4Removed = 0, pass5Removed = 0;

  // ═══ Pass 1: Exact Dedup (same funder, same source_url, near-identical names) ═══

  logSection('Pass 1: Exact Dedup');

  const { rows: allGrants } = await pool.query<GrantForDedup>(
    `SELECT id, funder_id, funder_name, name, description, url,
            regions, sectors, eligibility, amount_min, amount_max,
            deadline, application_form_url, source_url, data_quality_score
     FROM grants WHERE is_active AND pipeline_version = 2
     ORDER BY funder_id, source_url, name`
  );

  // Group by funder_id + source_url
  const groups = new Map<string, GrantForDedup[]>();
  for (const g of allGrants) {
    const key = `${g.funder_id}|${g.source_url || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(g);
  }

  const toRemove1 = new Set<string>();
  for (const [, grants] of groups) {
    if (grants.length < 2) continue;
    for (let i = 0; i < grants.length; i++) {
      if (toRemove1.has(grants[i].id)) continue;
      for (let j = i + 1; j < grants.length; j++) {
        if (toRemove1.has(grants[j].id)) continue;
        if (similarity(grants[i].name, grants[j].name) >= 0.83) {
          // Keep the one with higher quality score
          const keep = completeness(grants[i]) >= completeness(grants[j]) ? grants[i] : grants[j];
          const remove = keep === grants[i] ? grants[j] : grants[i];
          toRemove1.add(remove.id);
        }
      }
    }
  }

  if (APPLY && toRemove1.size > 0) {
    for (const id of toRemove1) {
      await pool.query(
        `UPDATE grants SET is_active = false, scrape_notes = 'dedup:exact-similarity' WHERE id = $1`, [id]
      );
    }
  }
  pass1Removed = toRemove1.size;
  console.log(`  ${APPLY ? 'Removed' : 'Would remove'}: ${pass1Removed} exact duplicates`);

  // ═══ Pass 2: Name Similarity Dedup ═══

  logSection('Pass 2: Name Similarity Dedup');

  // Group remaining grants by funder_id only
  const funderGroups = new Map<number, GrantForDedup[]>();
  for (const g of allGrants) {
    if (toRemove1.has(g.id)) continue;
    if (!funderGroups.has(g.funder_id)) funderGroups.set(g.funder_id, []);
    funderGroups.get(g.funder_id)!.push(g);
  }

  const toRemove2 = new Set<string>();
  for (const [, grants] of funderGroups) {
    if (grants.length < 2) continue;
    for (let i = 0; i < grants.length; i++) {
      if (toRemove2.has(grants[i].id)) continue;
      for (let j = i + 1; j < grants.length; j++) {
        if (toRemove2.has(grants[j].id)) continue;
        const nameSim = similarity(grants[i].name, grants[j].name);
        if (nameSim >= 0.85) {
          // For borderline cases, also check description similarity
          if (nameSim < 0.90) {
            const descSim = similarity(
              grants[i].description || '',
              grants[j].description || ''
            );
            if (descSim < 0.5) continue; // different descriptions = probably distinct
          }
          const keep = completeness(grants[i]) >= completeness(grants[j]) ? grants[i] : grants[j];
          const remove = keep === grants[i] ? grants[j] : grants[i];
          toRemove2.add(remove.id);
        }
      }
    }
  }

  if (APPLY && toRemove2.size > 0) {
    for (const id of toRemove2) {
      await pool.query(
        `UPDATE grants SET is_active = false, scrape_notes = 'dedup:name-similarity' WHERE id = $1`, [id]
      );
    }
  }
  pass2Removed = toRemove2.size;
  console.log(`  ${APPLY ? 'Removed' : 'Would remove'}: ${pass2Removed} name-similar duplicates`);

  // ═══ Pass 3: False-Split Audit ═══

  logSection('Pass 3: False-Split Audit');

  if (!process.env.OPENAI_API_KEY) {
    console.log('  Skipped (OPENAI_API_KEY required)');
  } else {
    // Find funders with 3+ grants from same source_url
    const { rows: splitCandidates } = await pool.query<{
      funder_name: string; source_url: string; grant_count: string;
    }>(`SELECT funder_name, source_url, COUNT(*)::text AS grant_count
        FROM grants WHERE is_active AND pipeline_version = 2 AND source_url IS NOT NULL
        GROUP BY funder_name, source_url
        HAVING COUNT(*) >= 3
        ORDER BY COUNT(*) DESC`);

    console.log(`  ${splitCandidates.length} funder/URL groups with 3+ grants`);

    const fsGroups: FalseSplitGroup[] = [];
    for (const sc of splitCandidates) {
      const { rows: grants } = await pool.query<{ id: string; name: string; description: string | null }>(
        `SELECT id, name, description FROM grants
         WHERE is_active AND funder_name = $1 AND source_url = $2
         ORDER BY name`,
        [sc.funder_name, sc.source_url]
      );
      fsGroups.push({ funder_name: sc.funder_name, source_url: sc.source_url, grants });
    }

    if (fsGroups.length > 0) {
      // Process in batches of 5 groups
      const toRemove3 = new Set<string>();
      for (let i = 0; i < fsGroups.length; i += 5) {
        const batch = fsGroups.slice(i, i + 5);
        try {
          const results = await classifyFalseSplits(batch);
          for (const r of results) {
            if (r.verdict === 'false_split') {
              for (const id of r.remove_ids) toRemove3.add(id);
            }
          }
        } catch (err) {
          console.error(`  False-split batch error:`, err);
        }
      }

      if (APPLY && toRemove3.size > 0) {
        for (const id of toRemove3) {
          await pool.query(
            `UPDATE grants SET is_active = false, scrape_notes = 'dedup:false-split' WHERE id = $1`, [id]
          );
        }
      }
      pass3Removed = toRemove3.size;
      console.log(`  ${APPLY ? 'Removed' : 'Would remove'}: ${pass3Removed} false-split records`);
    }
  }

  // ═══ Pass 4: Misnamed Grants ═══

  logSection('Pass 4: Misnamed Grants');

  // Pattern A: Grant name matches a charity name in the DB
  const { rows: misnamed } = await pool.query<{ grant_id: string; grant_name: string; charity_name: string }>(
    `SELECT g.id AS grant_id, g.name AS grant_name, c.name AS charity_name
     FROM grants g
     JOIN charities c ON LOWER(TRIM(g.name)) = LOWER(TRIM(c.name)) AND c.id != g.funder_id
     WHERE g.is_active AND g.pipeline_version = 2`
  );

  // Pattern B: Name looks like a government department without grant keywords
  const govPattern = /^(the )?(ministry|department|office|agency|commission|authority)\b/i;
  const grantKeywords = /\b(grant|fund|programme|program|scheme|award|support)\b/i;

  const { rows: allActive } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM grants WHERE is_active AND pipeline_version = 2`
  );

  const toRemove4 = new Set(misnamed.map(m => m.grant_id));
  for (const g of allActive) {
    if (govPattern.test(g.name) && !grantKeywords.test(g.name)) {
      toRemove4.add(g.id);
    }
  }

  if (APPLY && toRemove4.size > 0) {
    for (const id of toRemove4) {
      await pool.query(
        `UPDATE grants SET is_active = false, scrape_notes = 'dedup:misnamed' WHERE id = $1`, [id]
      );
    }
  }
  pass4Removed = toRemove4.size;
  console.log(`  ${APPLY ? 'Removed' : 'Would remove'}: ${pass4Removed} misnamed grants`);

  // ═══ Pass 5: Historical Round Listings ═══

  logSection('Pass 5: Historical Round Listings');

  const historicalPattern = /\b(successful|approved|awarded|funded|recipients?)\s+(grants?|funding|applications?)\s+\w+\s+\d{4}\b/i;
  const { rows: activeGrants } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM grants WHERE is_active AND pipeline_version = 2`
  );

  const toRemove5 = new Set<string>();
  for (const g of activeGrants) {
    if (historicalPattern.test(g.name)) toRemove5.add(g.id);
  }

  if (APPLY && toRemove5.size > 0) {
    for (const id of toRemove5) {
      await pool.query(
        `UPDATE grants SET is_active = false, scrape_notes = 'dedup:historical-listing' WHERE id = $1`, [id]
      );
    }
  }
  pass5Removed = toRemove5.size;
  console.log(`  ${APPLY ? 'Removed' : 'Would remove'}: ${pass5Removed} historical listings`);

  // ═══ Summary ═══

  const { rows: finalCount } = await pool.query(
    `SELECT COUNT(*)::text AS count FROM grants WHERE is_active AND pipeline_version = 2`
  );

  logSection('Summary');
  logSummary({
    'Starting count': startCount,
    'Pass 1 (exact dedup)': `-${pass1Removed}`,
    'Pass 2 (name similarity)': `-${pass2Removed}`,
    'Pass 3 (false splits)': `-${pass3Removed}`,
    'Pass 4 (misnamed)': `-${pass4Removed}`,
    'Pass 5 (historical)': `-${pass5Removed}`,
    'Total removed': pass1Removed + pass2Removed + pass3Removed + pass4Removed + pass5Removed,
    'Final count': APPLY ? finalCount[0].count : `${startCount - pass1Removed - pass2Removed - pass3Removed - pass4Removed - pass5Removed} (estimated)`,
    'Mode': APPLY ? 'APPLIED' : 'DRY RUN (use --apply to execute)',
  });

  await pool.end();
}

main().catch(err => { console.error('Pipeline step 4 failed:', err); process.exit(1); });
