/**
 * Manually seeds Otago Community Trust grant programs.
 *
 * OCT uses the Fluxx portal (oct.fluxx.io) so Tavily cannot extract programs
 * from their grants page. These are added from known public information.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/seed-oct-grants.ts
 */

import { Pool } from '@neondatabase/serverless';
import { createHash } from 'crypto';

function grantId(funderName: string, grantName: string, url: string): string {
  const input = `${funderName.trim().toLowerCase()}|${grantName.trim().toLowerCase()}|${url.trim().toLowerCase()}`;
  return 'g_' + createHash('sha256').update(input).digest('hex').slice(0, 16);
}

const FUNDER_ID = 541;
const FUNDER_NAME = 'Otago Community Trust';
const SOURCE_URL = 'https://www.oct.org.nz/funding/apply-for-funding';
const APPLY_URL = 'https://oct.fluxx.io';
const REGIONS = ['otago'];

const grants = [
  {
    name: 'OCT Community Grants',
    type: 'Foundation',
    description: 'The main grants fund of Otago Community Trust, open to community organisations across Otago. Supports projects and programmes that benefit the Otago community across all sectors including health, arts, environment, heritage, education, and sport. Two rounds per year — applications typically close in March and September.',
    amount_min: 1000,
    amount_max: 50000,
    sectors: ['community', 'health', 'arts-culture', 'environment', 'education', 'sport', 'social-services'],
    eligibility: ['Must be based in Otago', 'Must be a registered charity or community organisation', 'Must demonstrate community benefit'],
    deadline: 'biannual - typically March and September',
    is_recurring: true,
    round_frequency: 'biannual' as const,
  },
  {
    name: 'OCT Small Grants',
    type: 'Foundation',
    description: 'A quick-response fund for smaller community projects in Otago. Designed for organisations needing funding up to $5,000 for straightforward community activities, events, or equipment purchases. Applications are assessed on a rolling basis.',
    amount_min: null,
    amount_max: 5000,
    sectors: ['community', 'health', 'arts-culture', 'environment', 'education', 'sport', 'social-services', 'youth', 'elderly'],
    eligibility: ['Must be based in Otago', 'Must be a registered charity or community organisation', 'Project must benefit the Otago community'],
    deadline: 'rolling',
    is_recurring: true,
    round_frequency: 'rolling' as const,
  },
  {
    name: 'OCT Heritage Grants',
    type: 'Foundation',
    description: 'Supports the preservation and promotion of Otago\'s cultural and built heritage. Eligible projects include conservation of historic buildings and sites, archival projects, heritage interpretation, and programmes that celebrate Otago\'s history and identity.',
    amount_min: 1000,
    amount_max: 50000,
    sectors: ['arts-culture', 'community'],
    eligibility: ['Must be based in Otago', 'Project must relate to Otago heritage', 'Must be a registered charity or community organisation'],
    deadline: 'biannual - typically March and September',
    is_recurring: true,
    round_frequency: 'biannual' as const,
  },
  {
    name: 'OCT Environment Grants',
    type: 'Foundation',
    description: 'Supports environmental conservation, restoration, and sustainability projects in Otago. Funded activities include biodiversity restoration, pest control, waterway improvement, environmental education, and community-led conservation initiatives.',
    amount_min: 1000,
    amount_max: 50000,
    sectors: ['environment', 'community', 'rural'],
    eligibility: ['Must be based in Otago', 'Project must have a clear environmental benefit', 'Must be a registered charity or community organisation'],
    deadline: 'biannual - typically March and September',
    is_recurring: true,
    round_frequency: 'biannual' as const,
  },
];

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) { console.error('DATABASE_URL required'); process.exit(1); }
  const pool = new Pool({ connectionString: dbUrl });

  // Deactivate duplicate Rangatahi-Led Fund (older hash)
  await pool.query(
    `UPDATE grants SET is_active = false, updated_at = NOW() WHERE id = 'g_229414e1effe2344'`
  );
  console.log('✓ Deactivated duplicate Rangatahi-Led Fund (g_229414e1effe2344)');

  for (const g of grants) {
    const id = grantId(FUNDER_NAME, g.name, SOURCE_URL);
    await pool.query(
      `INSERT INTO grants (
         id, funder_id, funder_name, name, type, description, url,
         amount_min, amount_max, regions, sectors, eligibility,
         deadline, is_recurring, round_frequency, application_form_url,
         source_url, last_scraped_at, is_active, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12,
         $13, $14, $15, $16,
         $17, NOW(), true, NOW()
       )
       ON CONFLICT (id) DO UPDATE SET
         description = EXCLUDED.description,
         amount_min  = EXCLUDED.amount_min,
         amount_max  = EXCLUDED.amount_max,
         sectors     = EXCLUDED.sectors,
         eligibility = EXCLUDED.eligibility,
         deadline    = EXCLUDED.deadline,
         is_recurring = EXCLUDED.is_recurring,
         round_frequency = EXCLUDED.round_frequency,
         application_form_url = EXCLUDED.application_form_url,
         is_active   = true,
         updated_at  = NOW()`,
      [
        id, FUNDER_ID, FUNDER_NAME, g.name, g.type, g.description, SOURCE_URL,
        g.amount_min, g.amount_max, REGIONS, g.sectors, g.eligibility,
        g.deadline, g.is_recurring, g.round_frequency, APPLY_URL,
        SOURCE_URL,
      ]
    );
    console.log(`✓ Upserted: ${g.name} (${id})`);
  }

  const { rows } = await pool.query(
    `SELECT name, deadline, amount_max, sectors FROM grants WHERE funder_id = $1 AND is_active ORDER BY name`,
    [FUNDER_ID]
  );
  console.log(`\nActive OCT grants (${rows.length}):`);
  rows.forEach((r: {name: string; deadline: string; amount_max: number | null; sectors: string[]}) =>
    console.log(`  - ${r.name} | ${r.deadline} | max $${r.amount_max?.toLocaleString() ?? '?'} | [${r.sectors?.join(', ')}]`)
  );

  await pool.end();
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
