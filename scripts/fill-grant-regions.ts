/**
 * Fill missing regions on grants from funders with known regional scope.
 *
 * Strategy:
 *   1. Pattern-match funder names to regions (councils, community trusts)
 *   2. Only updates grants where regions IS NULL
 *   3. Does NOT touch grants from national funders (NULL = national is correct)
 *
 * Usage:
 *   npx tsx scripts/fill-grant-regions.ts            # dry run
 *   npx tsx scripts/fill-grant-regions.ts --apply     # write to DB
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }

const pool = new Pool({ connectionString: url });
const APPLY = process.argv.includes('--apply');

// Known regional funder name patterns → region(s)
// Covers councils, community trusts, and other clearly regional funders
const FUNDER_REGION_MAP: [RegExp, string[]][] = [
  // Northland
  [/far north|kaipara|whang.rei/i, ['northland']],
  [/northland/i, ['northland']],

  // Auckland
  [/auckland|waiheke|franklin|papakura|manukau|rodney|waitakere/i, ['auckland']],
  [/foundation north/i, ['auckland', 'northland']],

  // Waikato
  [/waikato|hamilton|matamata|piako|waipa|south waikato|ōtorohanga|otorohanga|waitomo|thames/i, ['waikato']],
  [/hauraki gulf/i, ['auckland', 'waikato']],
  [/hauraki district/i, ['waikato']],
  [/momentum waikato/i, ['waikato']],

  // Bay of Plenty
  [/bay of plenty|tauranga|western bay|rotorua|whakatāne|whakatane|kawerau|ōpōtiki|opotiki/i, ['bay-of-plenty']],
  [/baytrust|bay trust|sport bay of plenty/i, ['bay-of-plenty']],
  [/tect\b/i, ['bay-of-plenty']],

  // Gisborne
  [/gisborne|tairāwhiti|tairawhiti/i, ['gisborne']],
  [/eastland/i, ['gisborne']],

  // Hawke's Bay
  [/hawke|hastings|napier|central hawke|wairoa/i, ['hawkes-bay']],

  // Taranaki
  [/taranaki|new plymouth|south taranaki|stratford/i, ['taranaki']],
  [/toi foundation/i, ['taranaki']],
  [/taranaki electricity/i, ['taranaki']],

  // Manawatu-Whanganui
  [/manawat[uū]|palmerston north|whanganui|rangitīkei|rangitikei|ruapehu|horowhenua|tararua/i, ['manawatu-whanganui']],
  [/horizons regional/i, ['manawatu-whanganui']],

  // Wellington
  [/wellington|hutt|porirua|kāpiti|kapiti|wairarapa|south wairarapa|carterton|masterton/i, ['wellington']],
  [/trust house/i, ['wellington']],
  [/pulse energy/i, ['wellington']],
  [/nikau foundation/i, ['wellington']],

  // Tasman
  [/tasman district/i, ['tasman']],

  // Nelson
  [/nelson city|nelson district/i, ['nelson']],
  [/top of the south/i, ['nelson', 'tasman', 'marlborough']],

  // Marlborough
  [/marlborough/i, ['marlborough']],

  // West Coast
  [/west coast|westland|buller|grey district/i, ['west-coast']],

  // Canterbury
  [/canterbury|christchurch|selwyn|waimakariri|ashburton|hurunui|kaikōura|kaikoura|timaru|mackenzie/i, ['canterbury']],
  [/rātā foundation|rata foundation/i, ['wellington', 'canterbury']],

  // Otago
  [/otago|dunedin|queenstown|central otago|clutha|waitaki|waimate/i, ['otago']],

  // Southland
  [/southland|invercargill|gore district/i, ['southland']],
  [/community trust south/i, ['otago', 'southland']],
  [/ilt foundation/i, ['southland']],
];

async function main() {
  // Get all active grants with NULL regions, joined with funder info
  const { rows } = await pool.query<{
    grant_id: string;
    grant_name: string;
    funder_name: string;
    funder_type: string | null;
  }>(`
    SELECT g.id AS grant_id, g.name AS grant_name, c.name AS funder_name, c.funder_type
    FROM grants g
    JOIN charities c ON c.id = g.funder_id
    WHERE g.is_active AND g.regions IS NULL
    ORDER BY c.name, g.name
  `);

  console.log(`${rows.length} active grants with NULL regions\n`);

  const updates: { grantId: string; grantName: string; funderName: string; regions: string[] }[] = [];

  for (const row of rows) {
    for (const [pattern, regions] of FUNDER_REGION_MAP) {
      if (pattern.test(row.funder_name)) {
        updates.push({
          grantId: row.grant_id,
          grantName: row.grant_name,
          funderName: row.funder_name,
          regions,
        });
        break; // first match wins
      }
    }
  }

  console.log(`${updates.length} grants matched to regions:\n`);

  // Group by funder for display
  const byFunder = new Map<string, { regions: string[]; grants: string[] }>();
  for (const u of updates) {
    const key = u.funderName;
    const entry = byFunder.get(key) || { regions: u.regions, grants: [] };
    entry.grants.push(u.grantName);
    byFunder.set(key, entry);
  }

  for (const [funder, data] of [...byFunder.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${funder} → [${data.regions.join(', ')}] (${data.grants.length} grants)`);
  }

  const unmatched = rows.length - updates.length;
  console.log(`\n${unmatched} grants remain unmatched (likely national funders — NULL is correct)`);

  if (APPLY && updates.length > 0) {
    let written = 0;
    for (const u of updates) {
      await pool.query(
        `UPDATE grants SET regions = $1, updated_at = NOW() WHERE id = $2`,
        [u.regions, u.grantId]
      );
      written++;
    }
    console.log(`\nUpdated ${written} grants with region data.`);
  } else if (!APPLY && updates.length > 0) {
    console.log(`\nDry run. Run with --apply to update ${updates.length} grants.`);
  }

  // Show remaining NULL breakdown
  const { rows: remaining } = await pool.query<{ funder_type: string; n: string }>(`
    SELECT COALESCE(c.funder_type, 'NULL') AS funder_type, COUNT(*) AS n
    FROM grants g JOIN charities c ON c.id = g.funder_id
    WHERE g.is_active AND g.regions IS NULL
    GROUP BY c.funder_type ORDER BY n DESC
  `);
  console.log('\nRemaining NULL-region grants by funder type:');
  for (const r of remaining) {
    console.log(`  ${r.funder_type.padEnd(25)} ${r.n}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
