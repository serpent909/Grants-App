/**
 * Pipeline Step 1: Import all funder sources into the charities table.
 *
 * Replaces: import-charities.ts, import-curated-funders.ts, discover-websites.ts,
 *           discover-from-directories.ts, discover-trustee-grants.ts
 *
 * Stages:
 *   A. Charities Register (OData API) → ~6,300 charities
 *   B. Curated funder URLs (lib/markets/nz.ts) → ~272 funders
 *   C. Website discovery (email domains + Tavily search)
 *   D. Directory discovery (grant directories + trustee pages)
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/pipeline/01-import-funders.ts
 *   DATABASE_URL="..." TAVILY_API_KEY="..." npx tsx scripts/pipeline/01-import-funders.ts --with-discovery
 */

import { Pool } from '@neondatabase/serverless';
import { createHash } from 'crypto';
import { NZ_MARKET } from '../../lib/markets/nz';
import { createPool, hasFlag, logSection, logSummary } from '../../lib/pipeline/runner';
import { tavilySearch, tavilyExtract, headCheck } from '../../lib/pipeline/fetcher';

// ─── Config ─────────────────────────────────────────────────────────────────

const ODATA_BASE = 'http://www.odata.charities.govt.nz';
const PAGE_SIZE = 1000;
const BATCH_SIZE = 500;
const HEAD_CONCURRENCY = 20;
const TAVILY_CONCURRENCY = 5;

// Names unlikely to be external grant funders
const EXCLUDE_NAME_PATTERNS = /\b(school|PTSA|PTA|parent.?teacher|church|parish|mosque|temple|synagogue|scouts?|guides?|sports?\s*club|rugby\s*(league|union|club|football)?|cricket|football\s*club|netball|hockey\s*club|bowling|golf\s*club|swimming|surf\s*(club|life)|kindergarten|playcentre|preschool|kohanga|creche|playgroup|plunket|womens?\s*institute|rotary|lions?\s*club|kiwanis|jaycees|freemasons?|masonic|RSA\b|returned\s*services|mens?\s*shed|garden\s*club|bridge\s*club|tramping|mountaineering|rowing|sailing\s*club|yacht\s*club|tennis\s*club|squash|badminton|croquet|pony\s*club|riding\s*club)\b/i;

// Generic email providers
const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.nz', 'yahoo.co.uk',
  'hotmail.com', 'hotmail.co.nz', 'outlook.com', 'outlook.co.nz',
  'live.com', 'live.co.nz', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me', 'mail.com', 'zoho.com',
  'ymail.com', 'inbox.com', 'fastmail.com',
  'xtra.co.nz', 'slingshot.co.nz', 'vodafone.co.nz', 'spark.co.nz',
  'orcon.net.nz', 'kinect.co.nz', 'clear.net.nz', 'paradise.net.nz',
  'wave.co.nz', 'actrix.co.nz', 'callplus.net.nz', 'ihug.co.nz',
  'snap.net.nz', 'inspire.net.nz', '2degrees.nz', 'farmside.co.nz',
]);

// Professional service domains (not the charity's own website)
const PROFESSIONAL_DOMAINS = new Set([
  'publictrust.co.nz', 'perpetualguardian.co.nz', 'pgtrust.co.nz', 'nzgt.co.nz',
  'deloitte.co.nz', 'kpmg.co.nz', 'ey.com', 'pwc.co.nz', 'pwc.com',
  'bdo.co.nz', 'bdo.nz', 'grantthornton.co.nz', 'crowe.nz', 'crowe.co.nz',
  'buddlefindlay.com', 'chapmantripp.com', 'bellgully.com', 'russellmcveagh.com',
  'minterellison.co.nz', 'simpsongrierson.com', 'dentons.com', 'dlapiper.com',
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

interface ODataOrg {
  OrganisationId: number;
  Name: string;
  CharityRegistrationNumber: string;
  WebSiteURL: string | null;
  CharityEmailAddress: string | null;
  CharitablePurpose: string | null;
  MainSectorId: number | null;
  MainActivityId: number | null;
  RegistrationStatus: string;
}

function normaliseWebsite(url: string | null): string | null {
  if (!url || !url.trim()) return null;
  let u = url.trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = `https://${u}`;
  try { new URL(u); return u; } catch { return null; }
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.protocol = 'https:';
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/$/, '');
    return u.toString();
  } catch { return raw.trim(); }
}

function bareHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function curatedCharityNumber(normalizedUrl: string): string {
  return 'CU' + createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 8).toUpperCase();
}

function nameFromUrl(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').split('.')[0];
    return h.charAt(0).toUpperCase() + h.slice(1);
  } catch { return url.slice(0, 50); }
}

function extractDomain(email: string | null): string | null {
  if (!email) return null;
  const parts = email.trim().split('@');
  if (parts.length !== 2) return null;
  const domain = parts[1].toLowerCase();
  if (GENERIC_EMAIL_DOMAINS.has(domain) || PROFESSIONAL_DOMAINS.has(domain)) return null;
  return domain;
}

function shouldInclude(org: ODataOrg): boolean {
  if (org.RegistrationStatus !== 'Registered') return false;
  if (EXCLUDE_NAME_PATTERNS.test(org.Name)) return false;
  if (normaliseWebsite(org.WebSiteURL)) return true;
  if (org.MainActivityId === 3) return true;
  return false;
}

// ─── OData Fetcher ──────────────────────────────────────────────────────────

async function fetchPage(filter: string, skip: number): Promise<ODataOrg[]> {
  const url =
    `${ODATA_BASE}/Organisations?` +
    `$filter=${encodeURIComponent(filter)}` +
    `&$select=OrganisationId,Name,CharityRegistrationNumber,WebSiteURL,CharityEmailAddress,CharitablePurpose,MainSectorId,MainActivityId,RegistrationStatus` +
    `&$top=${PAGE_SIZE}&$skip=${skip}&$format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OData API returned ${res.status}`);
  const data = await res.json();
  return data.d?.results || (Array.isArray(data.d) ? data.d : null) || data.value || [];
}

async function fetchAllByFilter(label: string, filter: string): Promise<ODataOrg[]> {
  const allOrgs: ODataOrg[] = [];
  let skip = 0;
  console.log(`  Fetching: ${label}`);
  while (true) {
    const results = await fetchPage(filter, skip);
    if (results.length === 0) break;
    allOrgs.push(...results);
    skip += PAGE_SIZE;
    if (results.length < PAGE_SIZE) break;
  }
  console.log(`    → ${allOrgs.length} records`);
  return allOrgs;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE A: Charities Register Import
// ═══════════════════════════════════════════════════════════════════════════

async function stageA(pool: Pool): Promise<{ imported: number; updated: number }> {
  logSection('Stage A: Charities Register Import');

  const queries = [
    { label: 'Primary grant-makers (MainActivityId=3)', filter: `MainActivityId eq 3 and RegistrationStatus eq 'Registered'` },
    { label: 'Name contains "Trust"', filter: `substringof('Trust', Name) eq true and RegistrationStatus eq 'Registered'` },
    { label: 'Name contains "Foundation"', filter: `substringof('Foundation', Name) eq true and RegistrationStatus eq 'Registered'` },
    { label: 'Name contains "Fund"', filter: `substringof('Fund', Name) eq true and RegistrationStatus eq 'Registered'` },
    { label: 'Name contains "Endowment"', filter: `substringof('Endowment', Name) eq true and RegistrationStatus eq 'Registered'` },
    { label: 'Name contains "Charitable"', filter: `substringof('Charitable', Name) eq true and RegistrationStatus eq 'Registered'` },
    { label: 'Name contains "Grant"', filter: `substringof('Grant', Name) eq true and RegistrationStatus eq 'Registered'` },
    { label: 'Name contains "Gaming"', filter: `substringof('Gaming', Name) eq true and RegistrationStatus eq 'Registered'` },
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
  const filtered = allOrgs.filter(shouldInclude);
  console.log(`\n  Total unique: ${allOrgs.length} → After filtering: ${filtered.length}`);

  // Ensure columns exist
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'register'`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS curated_grant_url TEXT`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS regions TEXT[]`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS charity_email TEXT`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS website_source TEXT`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS main_activity_id INTEGER`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS discovery_source TEXT`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS data_confidence TEXT`);

  let inserted = 0, updated = 0;
  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    const batch = filtered.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const COLS = 8;
    const placeholders = batch.map((org, j) => {
      const base = j * COLS;
      values.push(
        org.CharityRegistrationNumber, org.Name, normaliseWebsite(org.WebSiteURL),
        org.CharitablePurpose?.slice(0, 5000) || null, org.MainSectorId,
        org.CharityEmailAddress?.trim() || null,
        normaliseWebsite(org.WebSiteURL) ? 'register' : null,
        org.MainActivityId ?? null,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, 'register', $${base + 6}, $${base + 7}, $${base + 8}, 'register')`;
    });

    const result = await pool.query(
      `INSERT INTO charities (charity_number, name, website_url, purpose, sector_id, source, charity_email, website_source, main_activity_id, discovery_source)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (charity_number) DO UPDATE SET
         name = EXCLUDED.name,
         website_url = COALESCE(EXCLUDED.website_url, charities.website_url),
         website_source = CASE
           WHEN charities.website_url IS NULL AND EXCLUDED.website_url IS NOT NULL THEN 'register'
           ELSE COALESCE(charities.website_source, EXCLUDED.website_source)
         END,
         purpose = EXCLUDED.purpose,
         sector_id = EXCLUDED.sector_id,
         charity_email = COALESCE(EXCLUDED.charity_email, charities.charity_email),
         main_activity_id = COALESCE(EXCLUDED.main_activity_id, charities.main_activity_id),
         discovery_source = COALESCE(charities.discovery_source, 'register')
       RETURNING (xmax = 0) AS is_insert`,
      values
    );

    for (const row of result.rows) {
      if (row.is_insert) inserted++; else updated++;
    }
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, filtered.length)}/${filtered.length} upserted...\r`);
  }

  console.log(`\n  Inserted: ${inserted}, Updated: ${updated}`);
  return { imported: inserted, updated };
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE B: Curated Funder Import
// ═══════════════════════════════════════════════════════════════════════════

async function stageB(pool: Pool): Promise<{ merged: number; inserted: number }> {
  logSection('Stage B: Curated Funder Import');

  const rawEntries = NZ_MARKET.curatedFunderUrls;
  const seenNormUrls = new Map<string, string>();
  const entries: Array<{ normUrl: string; regions: string[] | null }> = [];

  for (const entry of rawEntries) {
    const normUrl = normalizeUrl(entry.url);
    if (!seenNormUrls.has(normUrl)) {
      seenNormUrls.set(normUrl, entry.url);
      entries.push({ normUrl, regions: entry.regions ?? null });
    }
  }
  console.log(`  Curated list: ${rawEntries.length} raw → ${entries.length} unique`);

  // Cross-source dedup
  const hostnameCount = new Map<string, number>();
  for (const e of entries) {
    const h = bareHostname(e.normUrl);
    hostnameCount.set(h, (hostnameCount.get(h) ?? 0) + 1);
  }

  const { rows: registerRows } = await pool.query<{ id: number; charity_number: string; website_url: string }>(
    `SELECT id, charity_number, website_url FROM charities WHERE source = 'register' AND website_url IS NOT NULL`
  );

  const registerByHostname = new Map<string, { id: number }>();
  for (const row of registerRows) {
    const h = bareHostname(row.website_url);
    if (h && !registerByHostname.has(h)) registerByHostname.set(h, { id: row.id });
  }

  let merged = 0, inserted = 0;
  const mergedPairs: Array<{ curatedUrl: string; registerId: number }> = [];

  for (const entry of entries) {
    const h = bareHostname(entry.normUrl);
    const isSingle = (hostnameCount.get(h) ?? 0) === 1;
    const match = isSingle ? registerByHostname.get(h) : undefined;

    if (match) {
      await pool.query(
        `UPDATE charities SET curated_grant_url = $1, regions = $2,
         discovery_source = COALESCE(discovery_source, 'curated')
         WHERE id = $3`,
        [entry.normUrl, entry.regions, match.id]
      );
      mergedPairs.push({ curatedUrl: entry.normUrl, registerId: match.id });
      merged++;
    } else {
      const charityNumber = curatedCharityNumber(entry.normUrl);
      const name = nameFromUrl(entry.normUrl);
      await pool.query(
        `INSERT INTO charities (charity_number, name, website_url, source, curated_grant_url, regions, discovery_source)
         VALUES ($1, $2, NULL, 'curated', $3, $4, 'curated')
         ON CONFLICT (charity_number) DO UPDATE SET
           curated_grant_url = EXCLUDED.curated_grant_url,
           regions = EXCLUDED.regions
         WHERE charities.source = 'curated'`,
        [charityNumber, name, entry.normUrl, entry.regions]
      );
      inserted++;
    }
  }

  // Clean up orphan curated rows
  for (const { curatedUrl, registerId } of mergedPairs) {
    const { rows: orphans } = await pool.query<{ id: number }>(
      `SELECT id FROM charities WHERE source = 'curated' AND curated_grant_url = $1`, [curatedUrl]
    );
    for (const orphan of orphans) {
      await pool.query(`UPDATE grants SET funder_id = $1 WHERE funder_id = $2`, [registerId, orphan.id]);
      await pool.query(`DELETE FROM charities WHERE id = $1 AND source = 'curated'`, [orphan.id]);
    }
  }

  console.log(`  Merged with register: ${merged}, Inserted new: ${inserted}`);
  return { merged, inserted };
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE C: Website Discovery
// ═══════════════════════════════════════════════════════════════════════════

async function stageC(pool: Pool): Promise<{ fromEmail: number; fromTavily: number }> {
  logSection('Stage C: Website Discovery');

  if (!hasFlag('--with-discovery')) {
    console.log('  Skipped (pass --with-discovery to enable)');
    return { fromEmail: 0, fromTavily: 0 };
  }

  // Tier A: Email domain extraction
  const { rows: noWebsite } = await pool.query<{
    id: number; name: string; charity_email: string | null; main_activity_id: number | null;
  }>(`SELECT id, name, charity_email, main_activity_id FROM charities
      WHERE source = 'register' AND website_url IS NULL AND charity_email IS NOT NULL
      ORDER BY CASE WHEN main_activity_id = 3 THEN 0 ELSE 1 END, id`);

  console.log(`  Tier A: ${noWebsite.length} charities without websites have email addresses`);

  let fromEmail = 0;
  for (let i = 0; i < noWebsite.length; i += HEAD_CONCURRENCY) {
    const batch = noWebsite.slice(i, i + HEAD_CONCURRENCY);
    const checks = await Promise.allSettled(batch.map(async row => {
      const domain = extractDomain(row.charity_email);
      if (!domain) return null;
      const url = `https://${domain}`;
      const result = await headCheck(url);
      if (result.alive) return { id: row.id, url };
      const wwwUrl = `https://www.${domain}`;
      const wwwResult = await headCheck(wwwUrl);
      if (wwwResult.alive) return { id: row.id, url: wwwUrl };
      return null;
    }));

    for (const r of checks) {
      if (r.status === 'fulfilled' && r.value) {
        await pool.query(
          `UPDATE charities SET website_url = $1, website_source = 'email-domain' WHERE id = $2`,
          [r.value.url, r.value.id]
        );
        fromEmail++;
      }
    }
  }
  console.log(`  Tier A results: ${fromEmail} websites discovered from email domains`);

  // Tier B: Tavily search (if API key available)
  let fromTavily = 0;
  if (process.env.TAVILY_API_KEY) {
    const { rows: stillNoWebsite } = await pool.query<{ id: number; name: string }>(
      `SELECT id, name FROM charities
       WHERE source = 'register' AND website_url IS NULL AND main_activity_id = 3
       ORDER BY id LIMIT 500`
    );
    console.log(`  Tier B: Searching Tavily for ${stillNoWebsite.length} remaining charities`);

    for (let i = 0; i < stillNoWebsite.length; i += TAVILY_CONCURRENCY) {
      const batch = stillNoWebsite.slice(i, i + TAVILY_CONCURRENCY);
      const results = await Promise.allSettled(batch.map(async row => {
        const searchResults = await tavilySearch(`"${row.name}" New Zealand grants funding`, 3);
        for (const sr of searchResults) {
          const host = bareHostname(sr.url);
          if (!host || GENERIC_EMAIL_DOMAINS.has(host) || PROFESSIONAL_DOMAINS.has(host)) continue;
          const check = await headCheck(sr.url);
          if (check.alive) return { id: row.id, url: `https://${host}` };
        }
        return null;
      }));

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          await pool.query(
            `UPDATE charities SET website_url = $1, website_source = 'tavily-search' WHERE id = $2`,
            [r.value.url, r.value.id]
          );
          fromTavily++;
        }
      }
    }
    console.log(`  Tier B results: ${fromTavily} websites discovered via Tavily search`);
  }

  return { fromEmail, fromTavily };
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE D: Directory Discovery
// ═══════════════════════════════════════════════════════════════════════════

async function stageD(pool: Pool): Promise<{ newFunders: number }> {
  logSection('Stage D: Directory Discovery');

  if (!hasFlag('--with-discovery')) {
    console.log('  Skipped (pass --with-discovery to enable)');
    return { newFunders: 0 };
  }

  if (!process.env.TAVILY_API_KEY) {
    console.log('  Skipped (TAVILY_API_KEY required)');
    return { newFunders: 0 };
  }

  const directories = NZ_MARKET.grantDirectories || [];
  console.log(`  Scraping ${directories.length} grant directories...`);

  // Get existing URLs to avoid re-discovering
  const { rows: existing } = await pool.query<{ website_url: string; curated_grant_url: string }>(
    `SELECT website_url, curated_grant_url FROM charities WHERE website_url IS NOT NULL OR curated_grant_url IS NOT NULL`
  );
  const existingHosts = new Set<string>();
  for (const row of existing) {
    if (row.website_url) existingHosts.add(bareHostname(row.website_url));
    if (row.curated_grant_url) existingHosts.add(bareHostname(row.curated_grant_url));
  }

  const newUrls: string[] = [];
  for (const dirUrl of directories) {
    const content = await tavilyExtract(dirUrl, 50_000);
    if (!content) continue;

    // Extract URLs from content
    const urlRegex = /https?:\/\/[^\s"'<>)\]]+/g;
    const found = content.match(urlRegex) || [];
    for (const url of found) {
      const host = bareHostname(url);
      if (host && !existingHosts.has(host) && !GENERIC_EMAIL_DOMAINS.has(host) && !PROFESSIONAL_DOMAINS.has(host)) {
        existingHosts.add(host); // prevent duplicates within this run
        newUrls.push(url);
      }
    }
  }

  console.log(`  Found ${newUrls.length} potential new funder URLs from directories`);

  let newFunders = 0;
  for (const url of newUrls) {
    const charityNumber = curatedCharityNumber(normalizeUrl(url));
    const name = nameFromUrl(url);
    try {
      await pool.query(
        `INSERT INTO charities (charity_number, name, website_url, source, curated_grant_url, discovery_source)
         VALUES ($1, $2, $3, 'curated', $3, 'directory')
         ON CONFLICT (charity_number) DO NOTHING`,
        [charityNumber, name, url]
      );
      newFunders++;
    } catch { /* duplicate — skip */ }
  }

  console.log(`  Inserted ${newFunders} new funders from directories`);
  return { newFunders };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const pool = createPool();

  const resultA = await stageA(pool);
  const resultB = await stageB(pool);
  const resultC = await stageC(pool);
  const resultD = await stageD(pool);

  // Quality gate: summary
  logSection('Quality Gate');
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE source = 'register') AS from_register,
      COUNT(*) FILTER (WHERE source = 'curated') AS from_curated,
      COUNT(*) FILTER (WHERE discovery_source = 'directory') AS from_directory,
      COUNT(*) FILTER (WHERE website_url IS NOT NULL) AS with_website,
      COUNT(*) FILTER (WHERE website_url IS NULL) AS without_website,
      COUNT(*) FILTER (WHERE curated_grant_url IS NOT NULL) AS with_curated_url
    FROM charities
  `);

  const stats = rows[0];
  logSummary({
    'Total charities': stats.total,
    'From register': stats.from_register,
    'From curated list': stats.from_curated,
    'From directories': stats.from_directory,
    'With website': stats.with_website,
    'Without website': stats.without_website,
    'With curated grant URL': stats.with_curated_url,
    'Stage A (register imported)': resultA.imported,
    'Stage A (register updated)': resultA.updated,
    'Stage B (merged with register)': resultB.merged,
    'Stage B (new curated rows)': resultB.inserted,
    'Stage C (websites from email)': resultC.fromEmail,
    'Stage C (websites from Tavily)': resultC.fromTavily,
    'Stage D (new from directories)': resultD.newFunders,
  });

  await pool.end();
}

main().catch(err => { console.error('Pipeline step 1 failed:', err); process.exit(1); });
