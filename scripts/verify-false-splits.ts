/**
 * Verification pass for audit-false-splits.ts results.
 *
 * For every false_split group removing 3+ grants, fetches the funder's live
 * page via Tavily and asks GPT-4o (not mini) to confirm or overturn the verdict
 * with actual page content as evidence.
 *
 * Usage:
 *   npx tsx scripts/verify-false-splits.ts
 *
 * Outputs:
 *   CONFIRMED  — both models agree it's a false split
 *   DISPUTED   — GPT-4o disagrees with the original verdict (manual review needed)
 *   LOW-RISK   — groups with only 1-2 removals (not fetched, shown for reference)
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pool } from '@neondatabase/serverless';
import OpenAI from 'openai';
import { tavily } from '@tavily/core';

const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!dbUrl) { console.error('DATABASE_URL required'); process.exit(1); }
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) { console.error('OPENAI_API_KEY required'); process.exit(1); }
const tavilyKey = process.env.TAVILY_API_KEY;
if (!tavilyKey) { console.error('TAVILY_API_KEY required'); process.exit(1); }

const pool = new Pool({ connectionString: dbUrl });
const openai = new OpenAI({ apiKey });
const tavilyClient = tavily({ apiKey: tavilyKey });

// ─── Types ────────────────────────────────────────────────────────────────────

interface GrantRecord {
  id: string;
  name: string;
  description: string | null;
  eligibility: string[] | null;
  amount_min: number | null;
  amount_max: number | null;
  application_form_url: string | null;
}

interface FunderGroup {
  funder_name: string;
  source_url: string;
  keep: GrantRecord;
  remove: GrantRecord[];
}

interface VerificationResult {
  funder_name: string;
  source_url: string;
  original_verdict: 'false_split';
  verification: 'CONFIRMED' | 'DISPUTED' | 'SKIP';
  keep_name: string;
  remove_names: string[];
  reason: string;
  page_fetched: boolean;
}

// ─── Re-run the classification to get false_split groups ──────────────────────

async function getFalseSplitGroups(): Promise<FunderGroup[]> {
  // Same query as audit-false-splits.ts
  const { rows: grantRows } = await pool.query<{
    funder_id: string;
    funder_name: string;
    source_url: string;
    id: string;
    name: string;
    description: string | null;
    eligibility: string[] | null;
    amount_min: number | null;
    amount_max: number | null;
    application_form_url: string | null;
    sectors: string[] | null;
  }>(`
    SELECT
      c.id::text AS funder_id,
      c.name AS funder_name,
      LOWER(REGEXP_REPLACE(COALESCE(g.source_url, g.url), '/+$', '')) AS source_url,
      g.id, g.name, g.description, g.eligibility,
      g.amount_min, g.amount_max, g.application_form_url, g.sectors
    FROM grants g
    JOIN charities c ON c.id = g.funder_id
    WHERE g.is_active
      AND (c.id, LOWER(REGEXP_REPLACE(COALESCE(g.source_url, g.url), '/+$', ''))) IN (
        SELECT funder_id, LOWER(REGEXP_REPLACE(COALESCE(source_url, url), '/+$', ''))
        FROM grants
        WHERE is_active
        GROUP BY funder_id, LOWER(REGEXP_REPLACE(COALESCE(source_url, url), '/+$', ''))
        HAVING COUNT(*) >= 2
      )
    ORDER BY c.name, g.name
  `);

  const groupMap = new Map<string, { funder_name: string; source_url: string; grants: GrantRecord[] }>();
  for (const r of grantRows) {
    const key = `${r.funder_id}||${r.source_url}`;
    if (!groupMap.has(key)) groupMap.set(key, { funder_name: r.funder_name, source_url: r.source_url, grants: [] });
    groupMap.get(key)!.grants.push({ id: r.id, name: r.name, description: r.description, eligibility: r.eligibility, amount_min: r.amount_min, amount_max: r.amount_max, application_form_url: r.application_form_url });
  }

  // Re-classify with GPT-4.1-mini (same as audit script)
  const allGroups = Array.from(groupMap.values()).sort((a, b) => b.grants.length - a.grants.length);
  const BATCH = 8;
  const batches = [];
  for (let i = 0; i < allGroups.length; i += BATCH) batches.push(allGroups.slice(i, i + BATCH));

  const falseSplits: FunderGroup[] = [];
  let done = 0;
  const concurrency = 10;
  let idx = 0;

  async function worker() {
    while (idx < batches.length) {
      const i = idx++;
      const batch = batches[i];
      const payload = batch.map(g => ({
        funder_name: g.funder_name,
        source_url: g.source_url,
        grants: g.grants.map(gr => ({
          id: gr.id,
          name: gr.name,
          description: gr.description ? gr.description.slice(0, 300) : null,
          eligibility: gr.eligibility?.slice(0, 3) ?? null,
          amount_min: gr.amount_min,
          amount_max: gr.amount_max,
          has_own_form: !!gr.application_form_url,
        })),
      }));

      const system = `You are auditing a New Zealand grants database for false programme splits. A FALSE SPLIT is where one grant programme appears as multiple records because a scraper extracted thematic focus areas as separate grants. DISTINCT means genuinely separate programmes with different application processes or eligibility.

SIGNALS for FALSE SPLIT: names are theme words/priority areas, same source URL, no distinct eligibility, overlapping descriptions, no distinct application form per grant.
SIGNALS for DISTINCT: different application forms, meaningfully different amounts, names clearly indicate separate streams (e.g. "Quick Response" vs "Strategic Investment"), different applicant types.

When uncertain, classify as DISTINCT to avoid data loss.

Return JSON: { "groups": [{ "funder_name": "...", "verdict": "distinct"|"false_split", "keep_id": "g_...", "remove_ids": ["g_..."], "reason": "..." }] }`;

      try {
        const res = await openai.chat.completions.create({
          model: 'gpt-4.1-mini', temperature: 0, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }],
          max_tokens: 8000,
        });
        const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
        for (const v of (parsed.groups || [])) {
          if (v.verdict !== 'false_split' || !v.keep_id || !v.remove_ids?.length) continue;
          const grp = batch.find(g => g.funder_name === v.funder_name);
          if (!grp) continue;
          const keep = grp.grants.find(g => g.id === v.keep_id);
          const remove = grp.grants.filter(g => v.remove_ids.includes(g.id));
          if (keep && remove.length > 0) {
            falseSplits.push({ funder_name: grp.funder_name, source_url: grp.source_url, keep, remove });
          }
        }
      } catch (err) {
        console.error(`Batch ${i + 1} failed:`, err);
      }
      done++;
      process.stdout.write(`  Classification: ${done}/${batches.length} batches\r`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  console.log();
  return falseSplits;
}

// ─── Fetch page content via Tavily ───────────────────────────────────────────

async function fetchPage(url: string): Promise<string | null> {
  try {
    const result = await tavilyClient.extract([url]);
    const content = result?.results?.[0]?.rawContent;
    return content ? content.slice(0, 12000) : null;
  } catch {
    return null;
  }
}

// ─── GPT-4o verification with live page content ───────────────────────────────

async function verifyWithPageContent(group: FunderGroup, pageContent: string): Promise<{ verdict: 'CONFIRMED' | 'DISPUTED'; reason: string }> {
  const grantList = [group.keep, ...group.remove].map(g => ({
    id: g.id,
    name: g.name,
    db_description: g.description?.slice(0, 200) ?? null,
    eligibility: g.eligibility?.slice(0, 3) ?? null,
    amount_min: g.amount_min,
    amount_max: g.amount_max,
    has_own_form: !!g.application_form_url,
  }));

  const system = `You are a New Zealand grants data quality reviewer. You have been given:
1. The actual text content of a funder's grant page
2. A list of grant records in our database that all came from this page

Your job: determine whether these grants are GENUINELY DISTINCT programmes, or whether they are FALSE SPLITS of one programme (where a scraper created multiple records for thematic sections of a single grants programme).

An earlier automated check flagged these as a FALSE SPLIT. Your role is to CONFIRM or DISPUTE that verdict using the actual page content as evidence.

CONFIRM if: the page content shows these are themes/sections/focus areas of one grants programme — one application form, one set of eligibility criteria, described as one programme with multiple priorities.

DISPUTE if: the page content clearly shows these are separate programmes — different application forms, different eligibility, different deadlines, explicitly described as separate funds.

Be conservative: only DISPUTE if the page content clearly shows distinct programmes. If uncertain, CONFIRM.

Respond with JSON: { "verdict": "CONFIRMED"|"DISPUTED", "reason": "2-3 sentences citing specific evidence from the page content" }`;

  const user = `FUNDER: ${group.funder_name}
URL: ${group.source_url}

DATABASE RECORDS FROM THIS PAGE:
${JSON.stringify(grantList, null, 2)}

ACTUAL PAGE CONTENT:
${pageContent}`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o', temperature: 0, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: 500,
  });

  const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
  return {
    verdict: parsed.verdict === 'DISPUTED' ? 'DISPUTED' : 'CONFIRMED',
    reason: parsed.reason || '',
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nStep 1: Re-classifying all multi-grant groups...');
  const falseSplits = await getFalseSplitGroups();
  console.log(`Found ${falseSplits.length} false split groups\n`);

  // Separate high-risk (3+ removals) from low-risk (1-2 removals)
  const highRisk = falseSplits.filter(g => g.remove.length >= 3);
  const lowRisk = falseSplits.filter(g => g.remove.length < 3);

  console.log(`Step 2: Verifying ${highRisk.length} high-risk groups (3+ removals) with live page content + GPT-4o...`);
  console.log(`        Skipping ${lowRisk.length} low-risk groups (1-2 removals)\n`);

  const results: VerificationResult[] = [];
  let fetched = 0;

  // Process high-risk groups with concurrency 4 (Tavily + GPT-4o)
  const concurrency = 4;
  let idx = 0;
  async function worker() {
    while (idx < highRisk.length) {
      const i = idx++;
      const group = highRisk[i];
      const pageContent = await fetchPage(group.source_url);
      fetched++;
      process.stdout.write(`  ${fetched}/${highRisk.length} pages fetched\r`);

      let verification: 'CONFIRMED' | 'DISPUTED' | 'SKIP';
      let reason: string;

      if (!pageContent) {
        verification = 'SKIP';
        reason = 'Could not fetch page content — original verdict stands';
      } else {
        const v = await verifyWithPageContent(group, pageContent);
        verification = v.verdict;
        reason = v.reason;
      }

      results.push({
        funder_name: group.funder_name,
        source_url: group.source_url,
        original_verdict: 'false_split',
        verification,
        keep_name: group.keep.name,
        remove_names: group.remove.map(r => r.name),
        reason,
        page_fetched: !!pageContent,
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, highRisk.length) }, worker));
  console.log('\n');

  // ── Report ──────────────────────────────────────────────────────────────────

  const confirmed = results.filter(r => r.verification === 'CONFIRMED');
  const disputed = results.filter(r => r.verification === 'DISPUTED');
  const skipped = results.filter(r => r.verification === 'SKIP');

  const confirmedRemoveCount = confirmed.reduce((n, r) => n + r.remove_names.length, 0);
  const disputedRemoveCount = disputed.reduce((n, r) => n + r.remove_names.length, 0);
  const lowRiskRemoveCount = lowRisk.reduce((n, g) => n + g.remove.length, 0);
  const skippedRemoveCount = skipped.reduce((n, r) => n + r.remove_names.length, 0);

  console.log('═'.repeat(72));
  console.log('VERIFICATION SUMMARY');
  console.log('═'.repeat(72));
  console.log(`CONFIRMED false splits:  ${confirmed.length} groups, ${confirmedRemoveCount} grants safe to remove`);
  console.log(`DISPUTED  (keep intact): ${disputed.length} groups, ${disputedRemoveCount} grants — DO NOT remove`);
  console.log(`SKIPPED   (page 404):    ${skipped.length} groups, ${skippedRemoveCount} grants — original verdict`);
  console.log(`LOW-RISK  (1-2 removal): ${lowRisk.length} groups, ${lowRiskRemoveCount} grants — not verified`);
  console.log(`─`.repeat(72));
  console.log(`TOTAL safe to remove: ${confirmedRemoveCount + lowRiskRemoveCount + skippedRemoveCount}`);
  console.log(`TOTAL held back:      ${disputedRemoveCount}`);

  if (disputed.length > 0) {
    console.log('\n' + '═'.repeat(72));
    console.log('⚠  DISPUTED CASES — GPT-4o says these MAY be distinct programmes:');
    console.log('═'.repeat(72));
    for (const r of disputed) {
      console.log(`\nFUNDER: ${r.funder_name}`);
      console.log(`URL: ${r.source_url}`);
      console.log(`REASON: ${r.reason}`);
      console.log(`  Would have kept:    "${r.keep_name}"`);
      for (const n of r.remove_names) console.log(`  Would have removed: "${n}"`);
    }
  }

  console.log('\n' + '═'.repeat(72));
  console.log('CONFIRMED — safe to remove (high-risk groups verified by GPT-4o):');
  console.log('═'.repeat(72));
  for (const r of confirmed) {
    console.log(`\n✓ ${r.funder_name} (${r.remove_names.length} removed → "${r.keep_name}")`);
    console.log(`  ${r.reason}`);
  }

  console.log('\n' + '═'.repeat(72));
  console.log('LOW-RISK groups (1-2 removals, not live-verified):');
  console.log('═'.repeat(72));
  for (const g of lowRisk) {
    console.log(`  ${g.funder_name}: keep "${g.keep.name}" | remove: ${g.remove.map(r => `"${r.name}"`).join(', ')}`);
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
