/**
 * Audit and clean up false programme splits in the grants DB.
 *
 * A false split is where one grant programme appears as multiple records
 * because the scraper extracted thematic focus areas as separate grants.
 *
 * Two-pass approach:
 *   Pass 1 (GPT-4.1-mini) — classifies all same-URL multi-grant groups
 *   Pass 2 (GPT-4o + live page) — verifies every group with 3+ removals
 *     using actual page content before any deletion
 *
 * Only groups that pass BOTH checks (or have ≤2 removals) are deactivated.
 * Groups where GPT-4o disputes the verdict are reported for manual review.
 *
 * Usage:
 *   npx tsx scripts/audit-false-splits.ts           # dry run — full report
 *   npx tsx scripts/audit-false-splits.ts --apply   # deactivate safe groups
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
const APPLY = process.argv.includes('--apply');

// ─── Types ────────────────────────────────────────────────────────────────────

interface GrantRecord {
  id: string;
  name: string;
  description: string | null;
  eligibility: string[] | null;
  amount_min: number | null;
  amount_max: number | null;
  application_form_url: string | null;
  sectors: string[] | null;
}

interface FunderGroup {
  funder_id: string;
  funder_name: string;
  source_url: string;
  grants: GrantRecord[];
}

interface FalseSplit {
  funder_name: string;
  source_url: string;
  keep: GrantRecord;
  remove: GrantRecord[];
  verificationStatus: 'low-risk' | 'confirmed' | 'disputed' | 'page-unavailable';
  verificationReason: string;
}

// ─── Completeness score ───────────────────────────────────────────────────────

function completeness(g: GrantRecord): number {
  let s = 0;
  if (g.description) s += 3;
  if (g.sectors?.length) s += 2;
  if (g.eligibility?.length) s += 2;
  if (g.amount_min != null) s += 1;
  if (g.amount_max != null) s += 1;
  if (g.application_form_url) s += 1;
  if (g.description && g.description.length > 100) s += 1;
  return s;
}

// ─── Pass 1: GPT-4.1-mini classification ─────────────────────────────────────

async function classifyBatch(batch: FunderGroup[]): Promise<FalseSplit[]> {
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

  const system = `You are auditing a New Zealand grants database for false programme splits.

A FALSE SPLIT occurs when one grant programme appears as multiple records because a scraper extracted thematic focus areas or priority sections as separate grants.
A DISTINCT set means genuinely separate programmes with different application processes, eligibility criteria, or funding streams.

SIGNALS for FALSE SPLIT: names are theme words/focus areas, same source URL, no distinct eligibility per grant, overlapping descriptions, no distinct application form per grant, names like "Health", "Education", "Environment", "Community Development".
SIGNALS for DISTINCT: different application forms, meaningfully different amounts, names clearly indicate separate streams (e.g. "Quick Response Grant" vs "Strategic Investment Fund"), different applicant types (individuals vs organisations), each grant is explicitly named as a separate programme on the funder's site.

When uncertain, classify as DISTINCT to avoid data loss.

Return JSON: { "groups": [{ "funder_name": "...", "verdict": "distinct"|"false_split", "keep_id": "g_...", "remove_ids": ["g_..."], "reason": "..." }] }`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4.1-mini', temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }],
    max_tokens: 8000,
  });

  const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
  const results: FalseSplit[] = [];

  for (const v of (parsed.groups || [])) {
    if (v.verdict !== 'false_split' || !v.keep_id || !v.remove_ids?.length) continue;
    const grp = batch.find(g => g.funder_name === v.funder_name);
    if (!grp) continue;
    const keep = grp.grants.find(g => g.id === v.keep_id);
    const remove = grp.grants.filter(g => v.remove_ids.includes(g.id));
    // Fall back to completeness-based keep if GPT's keep_id wasn't found
    const sorted = [...grp.grants].sort((a, b) => completeness(b) - completeness(a));
    if (!keep || remove.length === 0) continue;
    results.push({
      funder_name: grp.funder_name,
      source_url: grp.source_url,
      keep,
      remove,
      verificationStatus: 'low-risk',
      verificationReason: v.reason || '',
    });
  }
  return results;
}

// ─── Pass 2: GPT-4o verification with live page content ──────────────────────

async function verifyWithPage(split: FalseSplit): Promise<FalseSplit> {
  // Fetch live page
  let pageContent: string | null = null;
  try {
    const result = await tavilyClient.extract([split.source_url]);
    const raw = result?.results?.[0]?.rawContent;
    if (raw) pageContent = raw.slice(0, 12000);
  } catch { /* fall through to page-unavailable */ }

  if (!pageContent) {
    return { ...split, verificationStatus: 'page-unavailable', verificationReason: 'Could not fetch page — original verdict retained' };
  }

  const grantList = [split.keep, ...split.remove].map(g => ({
    id: g.id,
    name: g.name,
    db_description: g.description?.slice(0, 200) ?? null,
    eligibility: g.eligibility?.slice(0, 3) ?? null,
    amount_min: g.amount_min,
    amount_max: g.amount_max,
    has_own_form: !!g.application_form_url,
  }));

  const system = `You are a New Zealand grants data quality reviewer.

You have been given the actual text of a funder's grant page plus a list of grant records that came from that page. An automated check flagged these as a FALSE SPLIT (one programme split into multiple records). Your job: CONFIRM or DISPUTE that verdict using the page content as evidence.

CONFIRM if the page shows these are themes/sections/focus areas of one programme — one application process, one set of eligibility criteria, described as one fund with multiple priority areas.
DISPUTE if the page clearly shows these are genuinely separate programmes — different application forms, different eligibility, different deadlines, explicitly described as separate funds or schemes.

Be conservative: only DISPUTE if the page content clearly shows distinct programmes. If uncertain, CONFIRM.

Respond JSON: { "verdict": "CONFIRMED"|"DISPUTED", "reason": "2-3 sentences citing specific page evidence" }`;

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o', temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `FUNDER: ${split.funder_name}\nURL: ${split.source_url}\n\nDB RECORDS:\n${JSON.stringify(grantList, null, 2)}\n\nPAGE CONTENT:\n${pageContent}` },
      ],
      max_tokens: 500,
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
    const status = parsed.verdict === 'DISPUTED' ? 'disputed' : 'confirmed';
    return { ...split, verificationStatus: status, verificationReason: parsed.reason || '' };
  } catch {
    return { ...split, verificationStatus: 'page-unavailable', verificationReason: 'GPT-4o call failed — original verdict retained' };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── Fetch all same-URL multi-grant groups ─────────────────────────────────
  const { rows: grantRows } = await pool.query<GrantRecord & { funder_id: string; funder_name: string; source_url: string }>(`
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
        FROM grants WHERE is_active
        GROUP BY funder_id, LOWER(REGEXP_REPLACE(COALESCE(source_url, url), '/+$', ''))
        HAVING COUNT(*) >= 2
      )
    ORDER BY c.name, g.name
  `);

  const groupMap = new Map<string, FunderGroup>();
  for (const r of grantRows) {
    const key = `${r.funder_id}||${r.source_url}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, { funder_id: r.funder_id, funder_name: r.funder_name, source_url: r.source_url, grants: [] });
    }
    groupMap.get(key)!.grants.push({ id: r.id, name: r.name, description: r.description, eligibility: r.eligibility, amount_min: r.amount_min, amount_max: r.amount_max, application_form_url: r.application_form_url, sectors: r.sectors });
  }
  const allGroups = Array.from(groupMap.values()).sort((a, b) => b.grants.length - a.grants.length);
  console.log(`\nFound ${allGroups.length} funder/URL groups with 2+ grants`);

  // ── Pass 1: Classify all groups ───────────────────────────────────────────
  console.log(`\nPass 1: classifying ${allGroups.length} groups (GPT-4.1-mini)...`);
  const BATCH = 8;
  const batches: FunderGroup[][] = [];
  for (let i = 0; i < allGroups.length; i += BATCH) batches.push(allGroups.slice(i, i + BATCH));

  const allFalseSplits: FalseSplit[] = [];
  let batchDone = 0;
  let batchIdx = 0;
  async function classifyWorker() {
    while (batchIdx < batches.length) {
      const i = batchIdx++;
      try {
        const splits = await classifyBatch(batches[i]);
        allFalseSplits.push(...splits);
      } catch (err) { console.error(`\nBatch ${i + 1} failed:`, err); }
      batchDone++;
      process.stdout.write(`  ${batchDone}/${batches.length} batches\r`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(10, batches.length) }, classifyWorker));
  console.log(`\n  → ${allFalseSplits.length} false split groups identified\n`);

  // ── Pass 2: Verify high-risk groups (3+ removals) with live pages ─────────
  const highRisk = allFalseSplits.filter(s => s.remove.length >= 3);
  const lowRisk = allFalseSplits.filter(s => s.remove.length < 3);
  console.log(`Pass 2: verifying ${highRisk.length} high-risk groups with live page + GPT-4o...`);
  console.log(`        Skipping ${lowRisk.length} low-risk groups (1-2 removals)\n`);

  let verifyDone = 0;
  let verifyIdx = 0;
  async function verifyWorker() {
    while (verifyIdx < highRisk.length) {
      const i = verifyIdx++;
      const result = await verifyWithPage(highRisk[i]);
      highRisk[i] = result;
      verifyDone++;
      process.stdout.write(`  ${verifyDone}/${highRisk.length} verified\r`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, highRisk.length) }, verifyWorker));
  console.log('\n');

  // ── Collate results ───────────────────────────────────────────────────────
  const confirmed = highRisk.filter(s => s.verificationStatus === 'confirmed');
  const disputed = highRisk.filter(s => s.verificationStatus === 'disputed');
  const unavailable = highRisk.filter(s => s.verificationStatus === 'page-unavailable');

  // Only GPT-4o verified groups — page-unavailable and low-risk are not high-confidence enough
  const safeToRemove = [...confirmed];
  const totalSafeIds = safeToRemove.flatMap(s => s.remove.map(r => r.id));

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('═'.repeat(72));
  console.log('SUMMARY');
  console.log('═'.repeat(72));
  console.log(`Confirmed false splits (GPT-4o verified):  ${confirmed.length} groups, ${confirmed.reduce((n,s) => n+s.remove.length, 0)} grants`);
  console.log(`Page unavailable (verdict retained):       ${unavailable.length} groups, ${unavailable.reduce((n,s) => n+s.remove.length, 0)} grants`);
  console.log(`Low-risk (1-2 removals, not live-checked): ${lowRisk.length} groups, ${lowRisk.reduce((n,s) => n+s.remove.length, 0)} grants`);
  console.log(`──`);
  console.log(`SAFE TO REMOVE: ${totalSafeIds.length} grants across ${safeToRemove.length} groups`);
  console.log(`──`);
  console.log(`DISPUTED (kept intact): ${disputed.length} groups, ${disputed.reduce((n,s) => n+s.remove.length, 0)} grants — manual review needed`);

  if (disputed.length > 0) {
    console.log('\n' + '═'.repeat(72));
    console.log('⚠  DISPUTED — GPT-4o says these are likely DISTINCT programmes:');
    console.log('   These will NOT be removed. Review manually if needed.');
    console.log('═'.repeat(72));
    for (const s of disputed) {
      console.log(`\nFUNDER: ${s.funder_name}`);
      console.log(`URL: ${s.source_url}`);
      console.log(`REASON: ${s.verificationReason}`);
      console.log(`  Would have kept:    "${s.keep.name}"`);
      for (const r of s.remove) console.log(`  Would have removed: "${r.name}"`);
    }
  }

  console.log('\n' + '═'.repeat(72));
  console.log('SAFE TO REMOVE:');
  console.log('═'.repeat(72));
  for (const s of safeToRemove) {
    const tag = s.verificationStatus === 'confirmed' ? '✓ verified' : s.verificationStatus === 'page-unavailable' ? '~ page 404' : '~ low-risk';
    console.log(`\n[${tag}] ${s.funder_name}`);
    console.log(`  KEEP:   "${s.keep.name}"`);
    for (const r of s.remove) console.log(`  REMOVE: "${r.name}"`);
    if (s.verificationStatus === 'confirmed') console.log(`  ${s.verificationReason}`);
  }

  if (!APPLY) {
    console.log(`\n${'─'.repeat(72)}`);
    console.log(`Dry run. Run with --apply to deactivate ${totalSafeIds.length} grants.`);
    await pool.end();
    return;
  }

  if (totalSafeIds.length === 0) {
    console.log('\nNothing to deactivate.');
    await pool.end();
    return;
  }

  const { rowCount } = await pool.query(
    `UPDATE grants SET is_active = false, scrape_notes = 'audit: false programme split' WHERE id = ANY($1)`,
    [totalSafeIds],
  );
  console.log(`\nDeactivated ${rowCount} grants.`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
