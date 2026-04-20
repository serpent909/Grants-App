/**
 * Pipeline Step 2: Classify all funders as grant-makers and assign funder types.
 *
 * Replaces: classify-grant-makers.ts, classify-funder-types.ts, classify-funder-types-gpt.ts
 *
 * Pass 1: GPT-4o classifies register charities as grant_maker / not_grant_maker / uncertain
 * Pass 2: Pattern rules + GPT-4o-mini classify funder type
 *
 * Usage:
 *   DATABASE_URL="..." OPENAI_API_KEY="..." npx tsx scripts/pipeline/02-classify-funders.ts
 *   DATABASE_URL="..." OPENAI_API_KEY="..." npx tsx scripts/pipeline/02-classify-funders.ts --force
 */

import {
  createPool, requireEnv, hasFlag, checkGate, logSection, logSummary,
} from '../../lib/pipeline/runner';
import {
  classifyGrantMakers, classifyFunderTypes,
  type ClassificationInput, type FunderTypeInput,
} from '../../lib/pipeline/extractor';

requireEnv('OPENAI_API_KEY');

// ─── Pattern-based funder type rules (from classify-funder-types.ts) ────────

const KNOWN_GAMING = [
  'aotearoa gaming trust', 'lion foundation', 'nzct', 'new zealand community trust',
  'pub charity', 'pelorus trust', 'the southern trust', 'first sovereign trust',
  'trillian trust', 'four winds foundation', 'youthtown',
  'the trusts community foundation', 'one foundation',
];

const KNOWN_GOVERNMENT = [
  'department of internal affairs', 'department of conservation',
  'ministry of social development', 'ministry of health', 'ministry of education',
  'ministry for the environment', 'ministry of business', 'ministry for pacific peoples',
  'ministry for ethnic communities', 'oranga tamariki', 'te puni kokiri',
  'sport new zealand', 'sport nz', 'creative new zealand', 'creative nz',
  'fire and emergency', 'heritage new zealand', 'new zealand film commission',
  'lotteries commission', 'lottery grants board', 'dia ', 'msd ',
  'civil defence', 'nzqa', 'waka kotahi', 'health research council',
  'callaghan innovation', 'new zealand trade and enterprise', 'nzte',
  'tertiary education commission', 'environmental protection authority',
  'nz on air', 'energy efficiency and conservation',
  'community organisation grants scheme', 'cogs',
];

const KNOWN_CORPORATE = [
  'air new zealand', 'bnz', 'westpac', 'anz ', 'kiwibank', 'z energy',
  'bp ', 'fonterra', 'spark', 'vodafone', 'mercury', 'meridian',
  'genesis energy', 'contact energy', 'trustpower', 'mazda',
  'mainfreight', 'toyota', 'noel leeming', 'warehouse',
  'countdown', 'new world', 'pak n save', 'mitre 10',
];

interface Rule { type: string; test: (name: string, lower: string) => boolean }

const rules: Rule[] = [
  { type: 'government', test: (_n, l) =>
    KNOWN_GOVERNMENT.some(g => l.includes(g)) || l.startsWith('lottery ') ||
    l.includes('minister\'s discretionary') || (l.includes('ministry') && l.includes('new zealand')),
  },
  { type: 'council', test: (_n, l) =>
    l.includes('district council') || l.includes('city council') ||
    l.includes('regional council') || l.includes('unitary authority') || l.endsWith(' council'),
  },
  { type: 'gaming-trust', test: (_n, l) =>
    KNOWN_GAMING.some(g => l.includes(g)) || l.includes('gaming trust') || l.includes('gaming foundation'),
  },
  { type: 'iwi', test: (_n, l) =>
    l.includes('iwi') || l.includes('hapū') || l.includes('hapu') ||
    l.includes('ngāi tahu') || l.includes('ngai tahu') ||
    l.includes('te rūnanga') || l.includes('te runanga') ||
    l.includes('māori trust board') || l.includes('maori trust board') ||
    l.includes('ngāti') || l.includes('ngati') ||
    (l.includes('maori') && (l.includes('trust') || l.includes('foundation'))),
  },
  { type: 'corporate', test: (_n, l) =>
    KNOWN_CORPORATE.some(c => l.includes(c)) || l.includes('staff foundation') ||
    (l.includes('corporate') && l.includes('foundation')),
  },
  { type: 'community-trust', test: (_n, l) =>
    l.includes('community trust') || l.includes('community foundation') ||
    l.includes('community fund') || l.includes('community matters') ||
    l.includes('foundation north') || l.includes('trust waikato') ||
    l.includes('trust horizon') || l.includes('trust house') ||
    l.includes('baytrust') || l.includes('central energy trust') ||
    l.includes('tect') || l.includes('rata foundation') || l.includes('rātā foundation') ||
    l.includes('nikau foundation') ||
    (l.includes('foundation') && /^(the )?(north|south|east|west|central|bay|waikato|otago|canterbury|nelson|tasman|marlborough|hawke|manawat|taranaki|whanganui|gisborne|southland)/.test(l)),
  },
  { type: 'sector-specific', test: (_n, l) =>
    l.includes('medical') || l.includes('health trust') || l.includes('health foundation') ||
    l.includes('cancer') || l.includes('heart') || l.includes('diabetes') ||
    l.includes('education trust') || l.includes('education foundation') ||
    l.includes('scholarship') || l.includes('research') ||
    l.includes('conservation') || l.includes('environment') ||
    l.includes('arts trust') || l.includes('arts foundation') ||
    l.includes('sport') || l.includes('disability') || l.includes('animal welfare'),
  },
  { type: 'family-foundation', test: (n, l) =>
    (/^(the )?[a-z]+ (family )?(foundation|charitable trust|trust)$/i.test(n) &&
      !l.includes('community') && !l.includes('gaming') && !l.includes('education')) ||
    l.includes('todd foundation') || l.includes('tindall foundation') ||
    l.includes('j r mckenzie') || l.includes('wayne francis'),
  },
];

function classifyByPattern(name: string): string {
  const lower = name.toLowerCase().trim();
  for (const rule of rules) {
    if (rule.test(name, lower)) return rule.type;
  }
  return 'other';
}

// ─── Main ───────────────────────────────────────────────────────────────────

const BATCH_SIZE = 40;

async function main() {
  const pool = createPool();
  const force = hasFlag('--force');

  // Gate: check Stage A has been run
  await checkGate(
    pool,
    'Charities imported (Stage A must have been run)',
    `SELECT COUNT(*)::text AS count FROM charities WHERE source = 'register'`,
    [],
    rows => Number(rows[0].count) > 1000,
  );

  // ── Pass 1: Grant-Maker Classification ─────────────────────────────────────

  logSection('Pass 1: Grant-Maker Classification (GPT-4o)');

  // Ensure columns exist
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS is_grant_maker BOOLEAN`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS classification_confidence TEXT`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS classification_notes TEXT`);

  const gmCondition = force ? '' : 'AND is_grant_maker IS NULL';
  const { rows: toClassify } = await pool.query<ClassificationInput>(
    `SELECT id, name, purpose, website_url
     FROM charities
     WHERE source = 'register' ${gmCondition}
     ORDER BY CASE WHEN main_activity_id = 3 THEN 0 ELSE 1 END, id`
  );

  console.log(`  ${toClassify.length} charities to classify as grant-makers`);

  let gmYes = 0, gmNo = 0, gmUncertain = 0;
  for (let i = 0; i < toClassify.length; i += BATCH_SIZE) {
    const batch = toClassify.slice(i, i + BATCH_SIZE);
    try {
      const results = await classifyGrantMakers(batch, 'gpt-4o');
      for (const r of results) {
        await pool.query(
          `UPDATE charities SET is_grant_maker = $1, classification_confidence = $2,
           classification_notes = $3, data_confidence = $4
           WHERE id = $5`,
          [
            r.is_grant_maker,
            r.confidence,
            r.notes,
            r.confidence === 'high' ? 'high' : r.confidence === 'medium' ? 'medium' : 'low',
            r.id,
          ]
        );
        if (r.is_grant_maker === true) gmYes++;
        else if (r.is_grant_maker === false) gmNo++;
        else gmUncertain++;
      }
    } catch (err) {
      console.error(`  Batch error at ${i}:`, err);
    }

    const done = Math.min(i + BATCH_SIZE, toClassify.length);
    process.stdout.write(`  ${done}/${toClassify.length} classified...\r`);
  }

  console.log(`\n  Grant-makers: ${gmYes} | Not grant-makers: ${gmNo} | Uncertain: ${gmUncertain}`);

  // Curated funders are always grant-makers
  await pool.query(
    `UPDATE charities SET is_grant_maker = true, classification_confidence = 'high', data_confidence = 'high'
     WHERE (source = 'curated' OR curated_grant_url IS NOT NULL) AND is_grant_maker IS NULL`
  );

  // ── Pass 2: Funder Type Classification ─────────────────────────────────────

  logSection('Pass 2: Funder Type Classification');

  // Pattern-based first
  const ftCondition = force ? '' : 'AND funder_type IS NULL';
  const { rows: toType } = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM charities
     WHERE (is_grant_maker = true OR curated_grant_url IS NOT NULL) ${ftCondition}
     ORDER BY name`
  );

  console.log(`  ${toType.length} funders to classify by type`);

  let patternClassified = 0, gptClassified = 0;
  const gptNeeded: FunderTypeInput[] = [];

  for (const f of toType) {
    const type = classifyByPattern(f.name);
    if (type !== 'other') {
      await pool.query(`UPDATE charities SET funder_type = $1 WHERE id = $2`, [type, f.id]);
      patternClassified++;
    } else {
      // Get first grant description for GPT context
      const { rows: grants } = await pool.query<{ description: string | null }>(
        `SELECT description FROM grants WHERE funder_id = $1 AND is_active LIMIT 1`, [f.id]
      );
      gptNeeded.push({
        id: f.id,
        name: f.name,
        purpose: null,
        grant_description: grants[0]?.description || null,
      });
    }
  }

  console.log(`  Pattern-classified: ${patternClassified} | Need GPT: ${gptNeeded.length}`);

  // GPT classification for remaining 'other' types
  for (let i = 0; i < gptNeeded.length; i += BATCH_SIZE) {
    const batch = gptNeeded.slice(i, i + BATCH_SIZE);
    try {
      const results = await classifyFunderTypes(batch, 'gpt-4o-mini');
      for (const r of results) {
        await pool.query(`UPDATE charities SET funder_type = $1 WHERE id = $2`, [r.funder_type, r.id]);
        gptClassified++;
      }
    } catch (err) {
      console.error(`  Batch error at ${i}:`, err);
    }
  }

  console.log(`  GPT-classified: ${gptClassified}`);

  // ── Quality Gate ───────────────────────────────────────────────────────────

  logSection('Quality Gate');
  const { rows: gateSummary } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE source = 'register' AND website_url IS NOT NULL) AS register_with_website,
      COUNT(*) FILTER (WHERE source = 'register' AND website_url IS NOT NULL AND is_grant_maker IS NOT NULL) AS classified,
      COUNT(*) FILTER (WHERE is_grant_maker = true) AS grant_makers,
      COUNT(*) FILTER (WHERE is_grant_maker = false) AS not_grant_makers,
      COUNT(*) FILTER (WHERE is_grant_maker IS NULL AND source = 'register') AS uncertain
    FROM charities
  `);

  const gs = gateSummary[0];
  const classificationRate = (Number(gs.classified) / Math.max(Number(gs.register_with_website), 1) * 100).toFixed(1);

  logSummary({
    'Register with website': gs.register_with_website,
    'Classified': `${gs.classified} (${classificationRate}%)`,
    'Grant-makers': gs.grant_makers,
    'Not grant-makers': gs.not_grant_makers,
    'Uncertain': gs.uncertain,
  });

  if (Number(classificationRate) < 90) {
    console.warn('⚠  Classification rate below 90% target. Consider running with --force.');
  } else {
    console.log('✓  Classification rate meets 90% target.');
  }

  // Funder type distribution
  const { rows: typeDistrib } = await pool.query(`
    SELECT funder_type, COUNT(*) AS n
    FROM charities WHERE is_grant_maker = true AND funder_type IS NOT NULL
    GROUP BY funder_type ORDER BY n DESC
  `);
  console.log('\n  Funder type distribution:');
  for (const row of typeDistrib) {
    console.log(`    ${String(row.funder_type).padEnd(22)} ${row.n}`);
  }

  await pool.end();
}

main().catch(err => { console.error('Pipeline step 2 failed:', err); process.exit(1); });
