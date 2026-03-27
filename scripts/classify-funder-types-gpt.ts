/**
 * GPT-assisted funder type classification for funders classified as "other"
 * by the pattern-matching script.
 *
 * Sends batches of funder name + purpose + first grant description to GPT-4o-mini
 * to classify into the same categories as classify-funder-types.ts.
 *
 * Only targets funders with active grants (no point classifying inactive funders).
 *
 * Usage:
 *   npx tsx scripts/classify-funder-types-gpt.ts              # dry run
 *   npx tsx scripts/classify-funder-types-gpt.ts --apply       # write to DB
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { Pool } from '@neondatabase/serverless';
import OpenAI from 'openai';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }
if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY required'); process.exit(1); }

const pool = new Pool({ connectionString: url });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 40;

const VALID_TYPES = new Set([
  'government', 'council', 'gaming-trust', 'community-trust',
  'iwi', 'corporate', 'family-foundation', 'sector-specific', 'other',
]);

interface FunderInfo {
  id: number;
  name: string;
  purpose: string | null;
  first_grant_name: string | null;
  first_grant_desc: string | null;
}

async function classifyBatch(funders: FunderInfo[]): Promise<Map<number, string>> {
  const funderList = funders.map(f => ({
    id: f.id,
    name: f.name,
    purpose: f.purpose?.slice(0, 200) || null,
    grant_example: f.first_grant_name || null,
    grant_desc: f.first_grant_desc?.slice(0, 150) || null,
  }));

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'system',
      content: `You classify New Zealand grant-making organisations into categories. Return valid JSON only.

Categories:
- government: Central government ministries, departments, Crown entities, statutory agencies
- council: Local/city/district/regional councils and territorial authorities
- gaming-trust: Gaming machine trusts that distribute proceeds (e.g. NZCT, Lion Foundation, Pub Charity)
- community-trust: Community foundations, regional endowment trusts, energy trusts that fund community projects
- iwi: Māori iwi/hapū trusts, rūnanga, Māori land trusts, Māori development organisations
- corporate: Corporate foundations, company CSR programs, industry bodies with grant programs
- family-foundation: Private/family philanthropic foundations and charitable trusts
- sector-specific: Organisations focused on a specific sector (health research, education, arts, sport, environment, etc.)
- other: Does not fit any category above, or insufficient information to classify

Use context clues: "Research Foundation" → sector-specific, "Māori Trust" → iwi, "Energy Trust" → community-trust, etc.
When in doubt, prefer "other" over guessing.`,
    }, {
      role: 'user',
      content: `Classify each funder into one of the categories above.

Funders:
${JSON.stringify(funderList, null, 0)}

Return JSON: { "results": [ { "id": 123, "type": "sector-specific" }, ... ] }`,
    }],
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw) as { results?: { id: number; type: string }[] };
  const map = new Map<number, string>();

  for (const r of parsed.results || []) {
    if (VALID_TYPES.has(r.type) && r.type !== 'other') {
      map.set(r.id, r.type);
    }
  }

  return map;
}

async function main() {
  // Get "other" funders that have active grants
  const { rows: funders } = await pool.query<FunderInfo>(`
    SELECT
      c.id,
      c.name,
      c.purpose,
      (SELECT g.name FROM grants g WHERE g.funder_id = c.id AND g.is_active LIMIT 1) AS first_grant_name,
      (SELECT g.description FROM grants g WHERE g.funder_id = c.id AND g.is_active LIMIT 1) AS first_grant_desc
    FROM charities c
    WHERE c.funder_type = 'other'
      AND EXISTS (SELECT 1 FROM grants g WHERE g.funder_id = c.id AND g.is_active)
    ORDER BY c.name
  `);

  console.log(`${funders.length} "other" funders with active grants to classify\n`);
  console.log(APPLY ? '*** APPLY MODE ***\n' : '*** DRY RUN ***\n');

  const reclassified = new Map<number, { name: string; newType: string }>();
  let batchNum = 0;

  for (let i = 0; i < funders.length; i += BATCH_SIZE) {
    const batch = funders.slice(i, i + BATCH_SIZE);
    batchNum++;

    try {
      const results = await classifyBatch(batch);
      for (const [id, type] of results) {
        const funder = batch.find(f => f.id === id);
        if (funder) {
          reclassified.set(id, { name: funder.name, newType: type });
        }
      }
      console.log(`Batch ${batchNum}: ${batch.length} funders → ${results.size} reclassified`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Batch ${batchNum} failed: ${msg.slice(0, 100)}`);
    }
  }

  // Summary by type
  const byType = new Map<string, string[]>();
  for (const [, { name, newType }] of reclassified) {
    const list = byType.get(newType) || [];
    list.push(name);
    byType.set(newType, list);
  }

  console.log(`\n${reclassified.size} funders reclassified from "other":\n`);
  for (const [type, names] of [...byType.entries()].sort()) {
    console.log(`=== ${type} (${names.length}) ===`);
    for (const n of names.sort()) {
      console.log(`  ${n}`);
    }
  }

  const stillOther = funders.length - reclassified.size;
  console.log(`\n${stillOther} funders remain as "other"`);

  if (APPLY && reclassified.size > 0) {
    let updated = 0;
    for (const [id, { newType }] of reclassified) {
      await pool.query(`UPDATE charities SET funder_type = $1 WHERE id = $2`, [newType, id]);
      updated++;
    }
    console.log(`\nUpdated ${updated} funders.`);
  } else if (!APPLY) {
    console.log(`\nDry run. Run with --apply to update ${reclassified.size} funders.`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
