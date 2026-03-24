/**
 * Import grant-giving charities from the NZ Charities Register into Postgres.
 *
 * Usage:
 *   DATABASE_URL="postgres://..." npx tsx scripts/import-charities.ts
 *
 * What it does:
 *   1. Fetches all charities whose primary activity is making grants (MainActivityId=3)
 *   2. Also fetches charities with "Trust", "Foundation", "Fund", or "Endowment" in
 *      their name — these are high-probability grant-givers regardless of primary activity
 *   3. Deduplicates by charity number
 *   4. Filters out noise (school PTAs, churches, sports clubs, etc.)
 *   5. Upserts into the `charities` table (source='register')
 *
 * Safe to re-run — uses ON CONFLICT to update existing records.
 */

import { Pool } from '@neondatabase/serverless';

const ODATA_BASE = 'http://www.odata.charities.govt.nz';
const PAGE_SIZE = 1000;

// Names matching these patterns are unlikely to be external grant funders
const EXCLUDE_NAME_PATTERNS = /\b(school|PTA|parent.?teacher|church|parish|mosque|temple|synagogue|scouts?|guides?|sports?\s*club|rugby\s*(league|union|club|football)?|cricket|football\s*club|netball|hockey\s*club|bowling|golf\s*club|swimming|surf\s*(club|life)|kindergarten|playcentre|preschool|kohanga|creche|playgroup|plunket|womens?\s*institute|rotary|lions?\s*club|kiwanis|jaycees|freemasons?|masonic|RSA\b|returned\s*services|mens?\s*shed|garden\s*club|bridge\s*club|tramping|mountaineering|rowing|sailing\s*club|yacht\s*club|tennis\s*club|squash|badminton|croquet|pony\s*club|riding\s*club)\b/i;

// Generic trustee websites that many perpetual trusts list as their "website"
const EXCLUDED_WEBSITES = new Set([
  'www.publictrust.co.nz',
  'publictrust.co.nz',
  'www.perpetualguardian.co.nz',
  'perpetualguardian.co.nz',
]);

interface ODataOrg {
  OrganisationId: number;
  Name: string;
  CharityRegistrationNumber: string;
  WebSiteURL: string | null;
  CharitablePurpose: string | null;
  MainSectorId: number | null;
  RegistrationStatus: string;
}

function normaliseWebsite(url: string | null): string | null {
  if (!url || !url.trim()) return null;
  let u = url.trim();

  const hostCheck = u.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (EXCLUDED_WEBSITES.has(hostCheck)) return null;

  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    u = `https://${u}`;
  }

  try {
    new URL(u);
    return u;
  } catch {
    return null;
  }
}

function shouldInclude(org: ODataOrg): boolean {
  if (org.RegistrationStatus !== 'Registered') return false;
  if (!normaliseWebsite(org.WebSiteURL)) return false;
  if (EXCLUDE_NAME_PATTERNS.test(org.Name)) return false;
  return true;
}

async function fetchPage(filter: string, skip: number): Promise<ODataOrg[]> {
  const url =
    `${ODATA_BASE}/Organisations?` +
    `$filter=${encodeURIComponent(filter)}` +
    `&$select=OrganisationId,Name,CharityRegistrationNumber,WebSiteURL,CharitablePurpose,MainSectorId,RegistrationStatus` +
    `&$top=${PAGE_SIZE}&$skip=${skip}` +
    `&$format=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`OData API returned ${res.status}: ${await res.text()}`);

  const data = await res.json();
  return data.d?.results || (Array.isArray(data.d) ? data.d : null) || data.value || [];
}

async function fetchAllByFilter(label: string, filter: string): Promise<ODataOrg[]> {
  const allOrgs: ODataOrg[] = [];
  let skip = 0;

  console.log(`\nFetching: ${label}`);

  while (true) {
    const results = await fetchPage(filter, skip);
    if (results.length === 0) break;

    allOrgs.push(...results);
    skip += PAGE_SIZE;
    process.stdout.write(`  ${allOrgs.length} fetched...\r`);

    if (results.length < PAGE_SIZE) break;
  }

  console.log(`  ${allOrgs.length} total`);
  return allOrgs;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) {
    console.error('Error: DATABASE_URL or POSTGRES_URL env var is required');
    process.exit(1);
  }

  // ── Fetch from multiple filters and merge ──────────────────────────────────

  const queries: { label: string; filter: string }[] = [
    {
      label: 'Primary grant-makers (MainActivityId=3)',
      filter: `MainActivityId eq 3 and RegistrationStatus eq 'Registered'`,
    },
    {
      label: 'Name contains "Trust"',
      filter: `substringof('Trust', Name) eq true and RegistrationStatus eq 'Registered'`,
    },
    {
      label: 'Name contains "Foundation"',
      filter: `substringof('Foundation', Name) eq true and RegistrationStatus eq 'Registered'`,
    },
    {
      label: 'Name contains "Fund"',
      filter: `substringof('Fund', Name) eq true and RegistrationStatus eq 'Registered'`,
    },
    {
      label: 'Name contains "Endowment"',
      filter: `substringof('Endowment', Name) eq true and RegistrationStatus eq 'Registered'`,
    },
  ];

  const seen = new Map<string, ODataOrg>();

  for (const { label, filter } of queries) {
    const orgs = await fetchAllByFilter(label, filter);
    for (const org of orgs) {
      if (!seen.has(org.CharityRegistrationNumber)) {
        seen.set(org.CharityRegistrationNumber, org);
      }
    }
  }

  const allOrgs = Array.from(seen.values());
  console.log(`\nTotal unique charities fetched: ${allOrgs.length}`);

  // ── Filter ─────────────────────────────────────────────────────────────────

  const filtered = allOrgs.filter(shouldInclude);
  const excluded = allOrgs.length - filtered.length;
  console.log(`After filtering: ${filtered.length} kept, ${excluded} excluded`);

  let noWebsite = 0;
  let nameExcluded = 0;
  let genericWebsite = 0;
  for (const org of allOrgs) {
    if (!org.WebSiteURL?.trim()) { noWebsite++; continue; }
    const normUrl = normaliseWebsite(org.WebSiteURL);
    if (!normUrl && org.WebSiteURL?.trim()) { genericWebsite++; continue; }
    if (EXCLUDE_NAME_PATTERNS.test(org.Name)) { nameExcluded++; }
  }
  console.log(`  - No website: ${noWebsite}`);
  console.log(`  - Generic trustee website: ${genericWebsite}`);
  console.log(`  - Name pattern excluded: ${nameExcluded}`);

  // ── Upsert into DB ─────────────────────────────────────────────────────────

  const pool = new Pool({ connectionString: dbUrl });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS charities (
      id SERIAL PRIMARY KEY,
      charity_number VARCHAR(10) UNIQUE NOT NULL,
      name TEXT NOT NULL,
      website_url TEXT,
      purpose TEXT,
      sector_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_charities_name_purpose_fts ON charities USING gin(to_tsvector('english', name || ' ' || COALESCE(purpose, '')))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_charities_sector ON charities(sector_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_charities_website ON charities(website_url) WHERE website_url IS NOT NULL`);

  // Ensure extended columns exist (from migration 003)
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'register'`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS curated_grant_url TEXT`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS regions TEXT[]`);

  let inserted = 0;
  let updated = 0;

  const BATCH_SIZE = 500;
  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    const batch = filtered.slice(i, i + BATCH_SIZE);

    // Build multi-row VALUES clause
    const values: unknown[] = [];
    const placeholders = batch.map((org, j) => {
      const base = j * 5;
      values.push(
        org.CharityRegistrationNumber,
        org.Name,
        normaliseWebsite(org.WebSiteURL),
        org.CharitablePurpose?.slice(0, 5000) || null,
        org.MainSectorId,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, 'register')`;
    });

    const result = await pool.query(
      `INSERT INTO charities (charity_number, name, website_url, purpose, sector_id, source)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (charity_number) DO UPDATE SET
         name = EXCLUDED.name,
         website_url = EXCLUDED.website_url,
         purpose = EXCLUDED.purpose,
         sector_id = EXCLUDED.sector_id
       RETURNING (xmax = 0) AS is_insert`,
      values
    );

    for (const row of result.rows) {
      if (row.is_insert) inserted++;
      else updated++;
    }

    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, filtered.length)}/${filtered.length} upserted...\r`);
  }

  console.log(`\nDone! Inserted: ${inserted}, Updated: ${updated}`);

  const { rows } = await pool.query('SELECT COUNT(*) AS total FROM charities');
  console.log(`Total records in charities table: ${rows[0].total}`);

  const { rows: withUrl } = await pool.query("SELECT COUNT(*) AS total FROM charities WHERE website_url IS NOT NULL AND source = 'register'");
  console.log(`Register records with website: ${withUrl[0].total}`);

  await pool.end();
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
