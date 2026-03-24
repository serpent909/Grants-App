/**
 * Classify register-sourced charities as grant-makers or not.
 *
 * Usage:
 *   DATABASE_URL="..." OPENAI_API_KEY="..." npx tsx scripts/classify-grant-makers.ts
 *   DATABASE_URL="..." OPENAI_API_KEY="..." npx tsx scripts/classify-grant-makers.ts --apply
 *
 * What it does:
 *   1. Queries all register-sourced funders that have active grants in the DB
 *   2. For each, sends name + purpose + extracted grant programs to GPT-4o
 *   3. GPT classifies as: grant_maker | not_grant_maker | uncertain
 *   4. Stores classification results in new charities columns
 *
 * By default runs in dry-run mode (classifies + stores results but does NOT
 * deactivate any grants). Pass --apply to also set grants.is_active = false
 * for confirmed non-grant-makers.
 *
 * Safe to re-run — skips funders already classified unless --force is passed.
 */

import { Pool } from '@neondatabase/serverless';
import OpenAI from 'openai';

const CONCURRENCY = 8;
const MODEL = 'gpt-4o';

type Classification = 'grant_maker' | 'not_grant_maker' | 'uncertain';
type Confidence = 'high' | 'medium' | 'low';

interface ClassificationResult {
  classification: Classification;
  confidence: Confidence;
  reasoning: string;
}

interface FunderRow {
  id: number;
  name: string;
  purpose: string | null;
  website_url: string | null;
  grants: Array<{ name: string; description: string | null }>;
}

async function classifyFunder(
  openai: OpenAI,
  funder: FunderRow,
): Promise<ClassificationResult> {
  const grantList = funder.grants
    .slice(0, 6)
    .map(g => `  - "${g.name}": ${(g.description || 'no description').slice(0, 200)}`)
    .join('\n');

  const prompt = `You are auditing a New Zealand grants database for data quality. Your task is to determine whether a registered charity is a GRANT-MAKER or not.

A GRANT-MAKER is an organisation that:
- Invites applications from other organisations or individuals
- Runs funding rounds with eligibility criteria
- Distributes money to external applicants (community trusts, foundations, councils, gaming trusts, corporate giving programmes, government agencies, etc.)

NOT a grant-maker includes:
- Service providers (hospices, mentoring programmes, radio stations, sports clubs, schools)
- Organisations that deliver programmes directly rather than funding others
- Charities whose website lists grants they themselves RECEIVE (a common mistake — their "grants" are their funding sources, not what they give out)
- Facility operators, membership associations, event organisers

---
Organisation name: ${funder.name}
Website: ${funder.website_url || 'not listed'}
Registered charitable purpose: ${funder.purpose || 'not specified'}

Programs extracted from their website (may be grants they give OR services they provide OR grants they receive):
${grantList || '  (none extracted)'}
---

Classify this organisation. Return JSON only:
{
  "classification": "grant_maker" | "not_grant_maker" | "uncertain",
  "confidence": "high" | "medium" | "low",
  "reasoning": "One sentence explaining the key signal that determined your answer."
}

Use "uncertain" only when there is genuine ambiguity (e.g. an organisation that both delivers services AND makes small grants to others).`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw) as Partial<ClassificationResult>;

  return {
    classification: parsed.classification ?? 'uncertain',
    confidence: parsed.confidence ?? 'low',
    reasoning: parsed.reasoning ?? '',
  };
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) { console.error('DATABASE_URL is required'); process.exit(1); }
  if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY is required'); process.exit(1); }

  const pool = new Pool({ connectionString: dbUrl });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');

  // Ensure classification columns exist
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS is_grant_maker BOOLEAN`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS classification_confidence TEXT`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS classification_notes TEXT`);

  // Load ALL register funders, with any extracted grants as additional signal.
  // We classify everyone — not just those with grants — so that:
  //   1. Confirmed grant-makers with no grants yet can be targeted for re-enrichment.
  //   2. Non-grant-makers with no grants are excluded from future enrichment runs.
  const alreadyDone = force ? '' : 'AND c.is_grant_maker IS NULL';
  const { rows: funders } = await pool.query<{
    id: number; name: string; purpose: string | null; website_url: string | null;
    grant_names: string[] | null; grant_descriptions: (string | null)[] | null;
  }>(`
    SELECT
      c.id, c.name, c.purpose, c.website_url,
      array_agg(g.name ORDER BY g.name) FILTER (WHERE g.id IS NOT NULL) AS grant_names,
      array_agg(g.description ORDER BY g.name) FILTER (WHERE g.id IS NOT NULL) AS grant_descriptions
    FROM charities c
    LEFT JOIN grants g ON g.funder_id = c.id AND g.is_active
    WHERE c.source = 'register' ${alreadyDone}
    GROUP BY c.id, c.name, c.purpose, c.website_url
    ORDER BY c.id
  `);

  const total = funders.length;
  console.log(`Classifying ${total} register funders${force ? ' (force, re-classifying all)' : ''}${apply ? ' [--apply mode: will deactivate non-grant-maker grants]' : ' [dry-run: use --apply to deactivate grants]'}\n`);
  if (total === 0) { await pool.end(); return; }

  const counts: Record<Classification, number> = { grant_maker: 0, not_grant_maker: 0, uncertain: 0 };
  const byConfidence: Record<string, number> = {};
  const notGrantMakerIds: number[] = [];

  for (let i = 0; i < funders.length; i += CONCURRENCY) {
    const batch = funders.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (row) => {
        const funder: FunderRow = {
          id: row.id,
          name: row.name,
          purpose: row.purpose,
          website_url: row.website_url,
          grants: (row.grant_names ?? []).map((name, idx) => ({
            name,
            description: row.grant_descriptions?.[idx] ?? null,
          })),
        };

        const result = await classifyFunder(openai, funder);

        await pool.query(
          `UPDATE charities
           SET is_grant_maker = $1, classification_confidence = $2, classification_notes = $3
           WHERE id = $4`,
          [
            result.classification === 'grant_maker' ? true
              : result.classification === 'not_grant_maker' ? false
              : null,  // uncertain → null
            result.confidence,
            result.reasoning,
            funder.id,
          ]
        );

        return { funder, result };
      })
    );

    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('  Error:', r.reason);
        continue;
      }
      const { funder, result } = r.value;
      counts[result.classification]++;
      const key = `${result.classification}/${result.confidence}`;
      byConfidence[key] = (byConfidence[key] ?? 0) + 1;

      if (result.classification === 'not_grant_maker') {
        notGrantMakerIds.push(funder.id);
        console.log(`  ✗ [${result.confidence}] ${funder.name} — ${result.reasoning}`);
      } else if (result.classification === 'uncertain') {
        console.log(`  ? [${result.confidence}] ${funder.name} — ${result.reasoning}`);
      }
    }

    const done = Math.min(i + CONCURRENCY, total);
    process.stdout.write(`Progress: ${done}/${total} | grant_maker: ${counts.grant_maker} | not: ${counts.not_grant_maker} | uncertain: ${counts.uncertain}\n`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('\n=== Classification results ===');
  console.log(`  Grant makers:     ${counts.grant_maker}`);
  console.log(`  Not grant makers: ${counts.not_grant_maker}`);
  console.log(`  Uncertain:        ${counts.uncertain}`);
  console.log('\n  Breakdown by confidence:');
  for (const [key, n] of Object.entries(byConfidence).sort()) {
    console.log(`    ${key}: ${n}`);
  }

  // Apply deactivations across ALL high-confidence non-grant-makers in the DB,
  // not just those classified in this run.
  const { rows: grantCount } = await pool.query(`
    SELECT COUNT(*) AS n FROM grants g
    JOIN charities c ON c.id = g.funder_id
    WHERE g.is_active AND c.is_grant_maker = false AND c.classification_confidence = 'high'
  `);
  console.log(`\n  Grants to deactivate (not_grant_maker + high confidence, all DB): ${grantCount[0].n}`);

  if (apply) {
    const result = await pool.query(`
      UPDATE grants SET
        is_active = false,
        scrape_notes = 'deactivated: funder classified as not_grant_maker (high confidence)'
      WHERE is_active
        AND funder_id IN (
          SELECT id FROM charities
          WHERE is_grant_maker = false AND classification_confidence = 'high'
        )
    `);
    console.log(`  Grants deactivated: ${result.rowCount}`);
  } else {
    console.log('  Run with --apply to deactivate these grants.');
  }

  const { rows: activeFinal } = await pool.query(
    `SELECT COUNT(*) AS n FROM grants WHERE is_active`
  );
  console.log(`\nActive grants in DB: ${activeFinal[0].n}`);

  await pool.end();
}

main().catch(err => {
  console.error('Classification failed:', err);
  process.exit(1);
});
