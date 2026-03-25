/**
 * Classify funders into types based on name patterns.
 * Types: government, council, gaming-trust, community-trust, iwi, corporate,
 *        family-foundation, sector-specific, other
 *
 * Usage:
 *   npx tsx scripts/classify-funder-types.ts            # dry run
 *   npx tsx scripts/classify-funder-types.ts --apply     # update DB
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }

const pool = new Pool({ connectionString: url });
const APPLY = process.argv.includes('--apply');

// ─── Classification rules (order matters — first match wins) ─────────────────

interface Rule {
  type: string;
  test: (name: string, lower: string) => boolean;
}

const KNOWN_GAMING: string[] = [
  'aotearoa gaming trust', 'lion foundation', 'nzct', 'new zealand community trust',
  'pub charity', 'pelorus trust', 'the southern trust', 'first sovereign trust',
  'trillian trust', 'four winds foundation', 'youthtown',
  'the trusts community foundation', 'one foundation',
];

const KNOWN_GOVERNMENT: string[] = [
  'department of internal affairs', 'department of conservation',
  'ministry of social development',
  'ministry of health', 'ministry of education', 'ministry for the environment',
  'ministry of business', 'ministry for pacific peoples', 'ministry for ethnic communities',
  'oranga tamariki', 'te puni kokiri', 'sport new zealand', 'sport nz',
  'creative new zealand', 'creative nz', 'fire and emergency',
  'heritage new zealand', 'new zealand film commission',
  'lotteries commission', 'lottery grants board', 'dia ', 'msd ',
  'civil defence', 'nzqa', 'careers new zealand',
  'waka kotahi', 'health research council', 'callaghan innovation',
  'new zealand trade and enterprise', 'nzte', 'tertiary education commission',
  'environmental protection authority', 'nz on air', 'greater wellington',
  'environment canterbury', 'energy efficiency and conservation',
  'community organisation grants scheme', 'cogs',
];

const KNOWN_CORPORATE: string[] = [
  'air new zealand', 'bnz', 'westpac', 'anz ', 'kiwibank', 'z energy',
  'bp ', 'fonterra', 'spark', 'vodafone', 'mercury', 'meridian',
  'genesis energy', 'contact energy', 'trustpower', 'mazda',
  'mainfreight', 'toyota', 'noel leeming', 'warehouse',
  'countdown', 'new world', 'pak n save', 'mitre 10',
  'bunnings', 'caltex', 'mobil',
];

const rules: Rule[] = [
  // Government / statutory bodies
  {
    type: 'government',
    test: (_n, l) =>
      KNOWN_GOVERNMENT.some(g => l.includes(g)) ||
      l.startsWith('lottery ') ||
      l.includes('minister\'s discretionary') ||
      (l.includes('ministry') && l.includes('new zealand')),
  },
  // Local/regional councils
  {
    type: 'council',
    test: (_n, l) =>
      l.includes('district council') || l.includes('city council') ||
      l.includes('regional council') || l.includes('unitary authority') ||
      l.endsWith(' council'),
  },
  // Gaming trusts
  {
    type: 'gaming-trust',
    test: (_n, l) =>
      KNOWN_GAMING.some(g => l.includes(g)) ||
      l.includes('gaming trust') || l.includes('gaming foundation'),
  },
  // Iwi / Māori trusts and organisations
  {
    type: 'iwi',
    test: (_n, l) =>
      l.includes('iwi') || l.includes('hapū') || l.includes('hapu') ||
      l.includes('waikato-tainui') || l.includes('tainui') ||
      l.includes('ngāi tahu') || l.includes('ngai tahu') ||
      l.includes('te rūnanga') || l.includes('te runanga') ||
      l.includes('māori trust board') || l.includes('maori trust board') ||
      l.includes('te pae') || l.includes('te taiwhenua') ||
      l.includes('te taha maori') || l.includes('māori purposes fund') ||
      l.includes('ngāti') || l.includes('ngati') ||
      l.includes('raupatu') || l.includes('papawai') ||
      l.includes('te putea whakatupu') || l.includes('te wānanga') ||
      l.includes('raukawa') || l.includes('tūwharetoa') ||
      l.includes('te aupouri') || l.includes('tai tokerau') ||
      (l.includes('maori') && (l.includes('trust') || l.includes('foundation'))),
  },
  // Corporate foundations / CSR programmes
  {
    type: 'corporate',
    test: (_n, l) =>
      KNOWN_CORPORATE.some(c => l.includes(c)) ||
      (l.includes('staff foundation')) ||
      (l.includes('corporate') && l.includes('foundation')),
  },
  // Community trusts / foundations (regional)
  {
    type: 'community-trust',
    test: (_n, l) =>
      l.includes('community trust') || l.includes('community foundation') ||
      l.includes('community fund') || l.includes('community matters') ||
      (l.includes('communit') && l.includes('board')) ||
      l.endsWith(' community') ||
      // Known community trusts/foundations
      l.includes('acorn foundation') || l.includes('auckland foundation') ||
      l.includes('wellington community') || l.includes('canterbury community') ||
      l.includes('foundation north') || l.includes('trust waikato') ||
      l.includes('trust horizon') || l.includes('trust house') ||
      l.includes('trusthouse') || l.includes('baytrust') ||
      l.includes('central energy trust') || l.includes('central lakes trust') ||
      l.includes('tect') || l.includes('wel energy') ||
      l.includes('rotorua energy') || l.includes('rotorua trust') ||
      l.includes('sunrise foundation') || l.includes('masterton trust lands') ||
      l.includes('south waikato investment fund') || l.includes('perpetual guardian') ||
      l.includes('rata foundation') || l.includes('rātā foundation') ||
      l.includes('common good foundation') ||
      l.includes('eastland network') || l.includes('powerco') ||
      l.includes('pulse energy') || l.includes('transpower') ||
      l.includes('four regions trust') || l.includes('nikau foundation') ||
      l.includes('mackenzie charitable foundation') ||
      // Regional foundations with geographic name
      (l.includes('foundation') && /^(the )?(north|south|east|west|central|bay|waikato|otago|canterbury|nelson|tasman|marlborough|hawke|manawat|taranaki|whanganui|gisborne|southland)/.test(l)),
  },
  // Sector-specific trusts (health, education, arts, environment, sport etc.)
  {
    type: 'sector-specific',
    test: (_n, l) =>
      l.includes('medical') || l.includes('health trust') || l.includes('health foundation') ||
      l.includes('cancer') || l.includes('heart') || l.includes('diabetes') ||
      l.includes('mental health') ||
      l.includes('education trust') || l.includes('education foundation') ||
      l.includes('scholarship') || l.includes('research') ||
      l.includes('conservation') || l.includes('biodiversity') ||
      l.includes('environment') || l.includes('ecological') ||
      l.includes('arts trust') || l.includes('arts foundation') ||
      l.includes('music') || l.includes('theatre') || l.includes('dance') ||
      l.includes('sport') || l.includes('paralympic') || l.includes('olympic') ||
      l.includes('animal welfare') || l.includes('spca') ||
      l.includes('disability') || l.includes('blind') || l.includes('deaf'),
  },
  // Family / private foundations (named after individuals)
  {
    type: 'family-foundation',
    test: (n, l) =>
      // Pattern: "The [Surname] Foundation/Trust" or "[FirstName LastName] Trust"
      (/^(the )?[a-z]+ (family )?(foundation|charitable trust|trust)$/i.test(n) &&
        !l.includes('community') && !l.includes('gaming') && !l.includes('education')) ||
      // Known family foundations
      l.includes('todd foundation') || l.includes('tindall foundation') ||
      l.includes('j r mckenzie') || l.includes('mckenzie trust') ||
      l.includes('wayne francis') || l.includes('nick wilkinson') ||
      l.includes('rata foundation'),
  },
];

function classify(name: string): string {
  const lower = name.toLowerCase().trim();
  for (const rule of rules) {
    if (rule.test(name, lower)) return rule.type;
  }
  return 'other';
}

async function main() {
  const { rows: funders } = await pool.query(`
    SELECT DISTINCT c.id, c.name
    FROM charities c
    JOIN grants g ON g.funder_id = c.id AND g.is_active
    ORDER BY c.name
  `);

  const counts: Record<string, number> = {};
  const updates: { id: number; name: string; type: string }[] = [];

  for (const f of funders) {
    const type = classify(f.name);
    counts[type] = (counts[type] || 0) + 1;
    updates.push({ id: f.id, name: f.name, type });
  }

  // Print summary
  console.log('Classification summary:');
  for (const [type, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(20)} ${count}`);
  }
  console.log(`  ${'TOTAL'.padEnd(20)} ${funders.length}`);

  // Print details by type
  for (const type of Object.keys(counts).sort()) {
    console.log(`\n=== ${type.toUpperCase()} ===`);
    for (const u of updates.filter(u => u.type === type)) {
      console.log(`  ${u.name}`);
    }
  }

  if (APPLY) {
    // Batch by type to reduce query count
    const byType = new Map<string, number[]>();
    for (const u of updates) {
      const arr = byType.get(u.type) || [];
      arr.push(u.id);
      byType.set(u.type, arr);
    }
    for (const [type, ids] of byType) {
      await pool.query('UPDATE charities SET funder_type = $1 WHERE id = ANY($2)', [type, ids]);
      console.log(`  Updated ${ids.length} funders as "${type}"`);
    }
    console.log(`\nUpdated ${updates.length} funders total.`);
  } else if (updates.length > 0) {
    console.log(`\nDry run. Run with --apply to update ${updates.length} funders.`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
