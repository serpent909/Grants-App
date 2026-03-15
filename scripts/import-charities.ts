/**
 * Import grant-giving charities from the NZ Charities Register into Postgres.
 *
 * Usage:
 *   DATABASE_URL="postgres://..." npx tsx scripts/import-charities.ts
 *
 * What it does:
 *   1. Fetches all registered charities with MainActivityId=3 ("makes grants to organisations")
 *   2. Filters out noise (school PTAs, churches, sports clubs, etc.)
 *   3. Upserts into the `charities` table
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

  // Skip excluded generic trustee websites
  const hostCheck = u.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (EXCLUDED_WEBSITES.has(hostCheck)) return null;

  // Ensure protocol
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
  // Must be registered
  if (org.RegistrationStatus !== 'Registered') return false;

  // Must have a usable website
  if (!normaliseWebsite(org.WebSiteURL)) return false;

  // Exclude by name pattern
  if (EXCLUDE_NAME_PATTERNS.test(org.Name)) return false;

  return true;
}

async function fetchAllOrgs(): Promise<ODataOrg[]> {
  const allOrgs: ODataOrg[] = [];
  let skip = 0;
  let hasMore = true;

  console.log('Fetching charities from NZ Charities Register...');

  while (hasMore) {
    const url = `${ODATA_BASE}/Organisations?` +
      `$filter=MainActivityId eq 3 and RegistrationStatus eq 'Registered'` +
      `&$select=OrganisationId,Name,CharityRegistrationNumber,WebSiteURL,CharitablePurpose,MainSectorId,RegistrationStatus` +
      `&$top=${PAGE_SIZE}&$skip=${skip}` +
      `&$format=json`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`OData API returned ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const results: ODataOrg[] = data.d?.results || (Array.isArray(data.d) ? data.d : null) || data.value || [];

    if (results.length === 0) {
      hasMore = false;
    } else {
      allOrgs.push(...results);
      skip += PAGE_SIZE;
      console.log(`  Fetched ${allOrgs.length} so far (page ${Math.ceil(skip / PAGE_SIZE)})...`);

      // Safety: if less than a full page, we're done
      if (results.length < PAGE_SIZE) hasMore = false;
    }
  }

  return allOrgs;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) {
    console.error('Error: DATABASE_URL or POSTGRES_URL env var is required');
    process.exit(1);
  }

  // 1. Fetch from OData API
  const allOrgs = await fetchAllOrgs();
  console.log(`\nTotal fetched: ${allOrgs.length}`);

  // 2. Filter
  const filtered = allOrgs.filter(shouldInclude);
  const excluded = allOrgs.length - filtered.length;
  console.log(`After filtering: ${filtered.length} kept, ${excluded} excluded`);

  // Breakdown of exclusion reasons (for logging)
  let noWebsite = 0, nameExcluded = 0, genericWebsite = 0;
  for (const org of allOrgs) {
    if (!org.WebSiteURL?.trim()) { noWebsite++; continue; }
    const normUrl = normaliseWebsite(org.WebSiteURL);
    if (!normUrl && org.WebSiteURL?.trim()) { genericWebsite++; continue; }
    if (EXCLUDE_NAME_PATTERNS.test(org.Name)) { nameExcluded++; }
  }
  console.log(`  - No website: ${noWebsite}`);
  console.log(`  - Generic trustee website: ${genericWebsite}`);
  console.log(`  - Name pattern excluded: ${nameExcluded}`);

  // 3. Upsert into DB
  const pool = new Pool({ connectionString: dbUrl });

  // Ensure table exists
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

  // Create indexes if not exist
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_charities_name_purpose_fts ON charities USING gin(to_tsvector('english', name || ' ' || COALESCE(purpose, '')))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_charities_sector ON charities(sector_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_charities_website ON charities(website_url) WHERE website_url IS NOT NULL`);

  let inserted = 0;
  let updated = 0;

  for (const org of filtered) {
    const website = normaliseWebsite(org.WebSiteURL);
    const result = await pool.query(
      `INSERT INTO charities (charity_number, name, website_url, purpose, sector_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (charity_number) DO UPDATE SET
         name = EXCLUDED.name,
         website_url = EXCLUDED.website_url,
         purpose = EXCLUDED.purpose,
         sector_id = EXCLUDED.sector_id
       RETURNING (xmax = 0) AS is_insert`,
      [
        org.CharityRegistrationNumber,
        org.Name,
        website,
        org.CharitablePurpose?.slice(0, 5000) || null,
        org.MainSectorId,
      ]
    );
    if (result.rows[0]?.is_insert) inserted++;
    else updated++;
  }

  console.log(`\nDone! Inserted: ${inserted}, Updated: ${updated}`);

  // Final count
  const { rows } = await pool.query('SELECT COUNT(*) AS total FROM charities');
  console.log(`Total records in charities table: ${rows[0].total}`);

  const { rows: withUrl } = await pool.query('SELECT COUNT(*) AS total FROM charities WHERE website_url IS NOT NULL');
  console.log(`Records with website: ${withUrl[0].total}`);

  await pool.end();
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
