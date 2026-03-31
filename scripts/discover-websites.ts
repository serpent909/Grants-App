/**
 * Discover website URLs for charities that were imported without one.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/discover-websites.ts                    # Tier A only (email domains)
 *   DATABASE_URL="..." TAVILY_API_KEY="..." npx tsx scripts/discover-websites.ts --tavily  # Both tiers
 *   DATABASE_URL="..." npx tsx scripts/discover-websites.ts --dry-run          # Preview without DB writes
 *   DATABASE_URL="..." TAVILY_API_KEY="..." npx tsx scripts/discover-websites.ts --tavily --limit 500
 *
 * Tier A — Email domain extraction (free):
 *   Extracts domain from charity_email, filters out generic/professional domains,
 *   validates via HTTP HEAD, and sets website_url + website_source='email-domain'.
 *
 * Tier B — Tavily web search (requires TAVILY_API_KEY, ~$0.005/search):
 *   Searches for charity name + grants, validates candidate URL via HTTP HEAD,
 *   and sets website_url + website_source='tavily-search'.
 *
 * Safe to re-run — only targets charities with website_url IS NULL.
 */

import { Pool } from '@neondatabase/serverless';

const HEAD_CONCURRENCY = 20;
const TAVILY_CONCURRENCY = 5;
const HEAD_TIMEOUT_MS = 10_000;

// ── Generic email providers (not the org's own domain) ────────────────────────

const GENERIC_EMAIL_DOMAINS = new Set([
  // Global providers
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.nz', 'yahoo.co.uk',
  'hotmail.com', 'hotmail.co.nz', 'outlook.com', 'outlook.co.nz',
  'live.com', 'live.co.nz', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me', 'mail.com', 'zoho.com',
  'ymail.com', 'inbox.com', 'fastmail.com',
  // NZ ISPs
  'xtra.co.nz', 'slingshot.co.nz', 'vodafone.co.nz', 'spark.co.nz',
  'orcon.net.nz', 'kinect.co.nz', 'clear.net.nz', 'paradise.net.nz',
  'wave.co.nz', 'actrix.co.nz', 'callplus.net.nz', 'ihug.co.nz',
  'snap.net.nz', 'inspire.net.nz', '2degrees.nz', 'farmside.co.nz',
  'iconz.co.nz', 'ts.co.nz', 'maxnet.co.nz', 'netspeed.net.nz',
  'woosh.co.nz', 'quicksilver.net.nz',
]);

// Professional services firms that commonly administer trusts — their domain
// is not the charity's website.
const PROFESSIONAL_DOMAINS = new Set([
  // Major trustee companies
  'publictrust.co.nz', 'perpetualguardian.co.nz', 'pgtrust.co.nz',
  'nzgt.co.nz',
  // Big 4 + mid-tier accounting
  'deloitte.co.nz', 'kpmg.co.nz', 'ey.com', 'pwc.co.nz', 'pwc.com',
  'bdo.co.nz', 'bdo.nz', 'grantthornton.co.nz', 'crowe.nz', 'crowe.co.nz',
  'bakertillysr.nz', 'findex.co.nz', 'rsmnz.co.nz', 'mazars.co.nz',
  'nexia.co.nz', 'mooremarkhams.co.nz', 'pkf.co.nz', 'pkfboi.nz',
  'williamscarlton.co.nz',
  // Large law firms
  'buddlefindlay.com', 'chapmantripp.com', 'bellgully.com',
  'russellmcveagh.com', 'minterellison.co.nz', 'simpsongrierson.com',
  'dentons.com', 'dlapiper.com', 'ajpark.com', 'heskethhenry.co.nz',
  'laneNeave.co.nz', 'laneneave.co.nz', 'wottonkearney.com',
  // Real estate
  'raywhite.com', 'barfoot.co.nz', 'bayleys.co.nz', 'harcourts.co.nz',
]);

// Patterns that suggest a professional services domain (small law/accounting firms)
const PROFESSIONAL_DOMAIN_PATTERNS = [
  /law\.co\.nz$/, /law\.nz$/, /legal\.co\.nz$/, /legal\.nz$/,
  /lawyers\.co\.nz$/, /solicitors\.co\.nz$/,
  /accounting\.co\.nz$/, /accountants\.co\.nz$/,
  /chartered\.co\.nz$/, /audit\.co\.nz$/,
];

// Domains to skip in Tavily search results
const SKIP_RESULT_DOMAINS = new Set([
  'charities.govt.nz', 'register.charities.govt.nz',
  'facebook.com', 'linkedin.com', 'nz.linkedin.com', 'twitter.com', 'instagram.com',
  'youtube.com', 'tiktok.com',
  'nzbn.govt.nz', 'companiesoffice.govt.nz',
  'givealittle.co.nz', 'everydayhero.com',
  // Directory / aggregator sites (not the charity's own website)
  'charitydata.co.nz', 'nzxplorer.co.nz',
  'fconline.foundationcenter.org', 'candid.org',
  // News / reference
  'en.wikipedia.org', 'wikipedia.org', 'stuff.co.nz', 'www.stuff.co.nz',
  'nzherald.co.nz', 'rnz.co.nz',
  // Government (not the charity itself)
  'natlib.govt.nz', 'dia.govt.nz', 'govt.nz',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractDomain(email: string | null): string | null {
  if (!email?.trim()) return null;
  const parts = email.trim().split('@');
  if (parts.length !== 2) return null;
  return parts[1].toLowerCase();
}

function isGenericOrProfessional(domain: string): boolean {
  if (GENERIC_EMAIL_DOMAINS.has(domain)) return true;
  if (PROFESSIONAL_DOMAINS.has(domain)) return true;
  if (PROFESSIONAL_DOMAIN_PATTERNS.some(p => p.test(domain))) return true;
  // School domains
  if (/\.(school|ac|edu)\.(nz|com)$/i.test(domain)) return true;
  return false;
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

async function httpHeadCheck(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrantSearchBot/1.0)' },
    });
    clearTimeout(timeout);
    return res.ok || (res.status >= 300 && res.status < 400);
  } catch {
    return false;
  }
}

/** Run tasks in batches with concurrency limit. */
async function batchProcess<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((item, j) => fn(item, i + j)),
    );
    for (const r of batchResults) {
      results.push(r.status === 'fulfilled' ? r.value : (null as unknown as R));
    }
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface CharityRow {
  id: number;
  name: string;
  charity_email: string | null;
  main_activity_id: number | null;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) { console.error('DATABASE_URL is required'); process.exit(1); }

  const dryRun = process.argv.includes('--dry-run');
  const runTavily = process.argv.includes('--tavily');
  const limitArg = process.argv.indexOf('--limit');
  const tavilyLimit = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : 2000;

  if (runTavily && !process.env.TAVILY_API_KEY) {
    console.error('TAVILY_API_KEY is required when using --tavily');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });

  if (dryRun) console.log('[DRY RUN] No database writes will be made.\n');

  // ── Tier A: Email domain discovery ────────────────────────────────────────

  console.log('═══ Tier A: Email Domain Discovery ═══\n');

  const { rows: emailCandidates } = await pool.query<CharityRow>(`
    SELECT id, name, charity_email, main_activity_id
    FROM charities
    WHERE website_url IS NULL
      AND charity_email IS NOT NULL
      AND source = 'register'
    ORDER BY
      CASE WHEN main_activity_id = 3 THEN 0 ELSE 1 END,
      id
  `);

  console.log(`Charities with email but no website: ${emailCandidates.length}`);

  // Extract and filter domains
  const tierACandidates: Array<CharityRow & { domain: string; candidateUrl: string }> = [];
  let skippedGeneric = 0;
  let skippedProfessional = 0;

  for (const row of emailCandidates) {
    const domain = extractDomain(row.charity_email);
    if (!domain) continue;

    if (GENERIC_EMAIL_DOMAINS.has(domain)) { skippedGeneric++; continue; }
    if (PROFESSIONAL_DOMAINS.has(domain) || PROFESSIONAL_DOMAIN_PATTERNS.some(p => p.test(domain))) {
      skippedProfessional++;
      continue;
    }
    if (/\.(school|ac|edu)\.(nz|com)$/i.test(domain)) { skippedGeneric++; continue; }

    tierACandidates.push({
      ...row,
      domain,
      candidateUrl: `https://${domain}`,
    });
  }

  console.log(`Candidates after filtering: ${tierACandidates.length}`);
  console.log(`  Skipped generic email: ${skippedGeneric}`);
  console.log(`  Skipped professional: ${skippedProfessional}`);
  console.log(`\nValidating ${tierACandidates.length} domains via HTTP HEAD...\n`);

  let tierADiscovered = 0;
  let tierAFailed = 0;

  await batchProcess(tierACandidates, HEAD_CONCURRENCY, async (candidate, idx) => {
    // Try bare domain first, then with www
    let valid = await httpHeadCheck(candidate.candidateUrl);
    let finalUrl = candidate.candidateUrl;

    if (!valid) {
      finalUrl = `https://www.${candidate.domain}`;
      valid = await httpHeadCheck(finalUrl);
    }

    if (valid) {
      tierADiscovered++;
      if (!dryRun) {
        await pool.query(
          `UPDATE charities SET website_url = $1, website_source = 'email-domain' WHERE id = $2`,
          [finalUrl, candidate.id],
        );
      }
      if (tierADiscovered <= 10 || tierADiscovered % 50 === 0) {
        console.log(`  ✓ ${candidate.name} → ${finalUrl}`);
      }
    } else {
      tierAFailed++;
    }

    if ((idx + 1) % 100 === 0) {
      process.stdout.write(`  Progress: ${idx + 1}/${tierACandidates.length} checked...\r`);
    }
  });

  console.log(`\nTier A results:`);
  console.log(`  Discovered: ${tierADiscovered}`);
  console.log(`  Failed HEAD check: ${tierAFailed}`);

  // ── Tier B: Tavily web search ─────────────────────────────────────────────

  if (!runTavily) {
    console.log(`\nSkipping Tier B (use --tavily to enable web search discovery).`);
  } else {
    console.log(`\n═══ Tier B: Tavily Web Search Discovery ═══\n`);

    const { tavily } = await import('@tavily/core');
    const tc = tavily({ apiKey: process.env.TAVILY_API_KEY! });

    // Only search for MainActivityId=3 charities still without a website
    const { rows: tavilyCandidates } = await pool.query<CharityRow>(`
      SELECT id, name, charity_email, main_activity_id
      FROM charities
      WHERE website_url IS NULL
        AND source = 'register'
        AND main_activity_id = 3
      ORDER BY id
      LIMIT $1
    `, [tavilyLimit]);

    console.log(`Charities to search: ${tavilyCandidates.length} (limit: ${tavilyLimit})`);

    let tierBDiscovered = 0;
    let tierBNoResult = 0;
    let tierBFailed = 0;
    let tavilyCalls = 0;

    await batchProcess(tavilyCandidates, TAVILY_CONCURRENCY, async (candidate, idx) => {
      try {
        const query = `"${candidate.name}" New Zealand`;
        tavilyCalls++;
        const result = await tc.search(query, {
          maxResults: 5,
          includeAnswer: false,
        });

        // Find best candidate URL from results
        const urls = (result.results || [])
          .map((r: { url: string }) => r.url)
          .filter((url: string) => {
            const d = domainFromUrl(url);
            return d && !SKIP_RESULT_DOMAINS.has(d) && !isGenericOrProfessional(d);
          });

        if (urls.length === 0) {
          tierBNoResult++;
          return;
        }

        // Prefer .nz and .org domains, take the first match
        const preferred = urls.find((url: string) => /\.(co\.nz|org\.nz|nz|org)($|\/)/.test(url));
        const candidateUrl = preferred || urls[0];

        // Validate via HEAD check
        const valid = await httpHeadCheck(candidateUrl);
        if (!valid) {
          tierBFailed++;
          return;
        }

        // Extract just the homepage (strip path)
        let homepage: string;
        try {
          const u = new URL(candidateUrl);
          homepage = `${u.protocol}//${u.hostname}`;
        } catch {
          homepage = candidateUrl;
        }

        tierBDiscovered++;
        if (!dryRun) {
          await pool.query(
            `UPDATE charities SET website_url = $1, website_source = 'tavily-search' WHERE id = $2`,
            [homepage, candidate.id],
          );
        }
        if (tierBDiscovered <= 10 || tierBDiscovered % 50 === 0) {
          console.log(`  ✓ ${candidate.name} → ${homepage}`);
        }
      } catch (err) {
        tierBFailed++;
      }

      if ((idx + 1) % 50 === 0) {
        process.stdout.write(`  Progress: ${idx + 1}/${tavilyCandidates.length} searched...\r`);
      }
    });

    console.log(`\nTier B results:`);
    console.log(`  Tavily API calls: ${tavilyCalls}`);
    console.log(`  Discovered: ${tierBDiscovered}`);
    console.log(`  No relevant result: ${tierBNoResult}`);
    console.log(`  Failed validation: ${tierBFailed}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────

  const { rows: summary } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE website_url IS NULL AND source = 'register') AS pending,
      COUNT(*) FILTER (WHERE website_source = 'email-domain') AS from_email,
      COUNT(*) FILTER (WHERE website_source = 'tavily-search') AS from_tavily,
      COUNT(*) FILTER (WHERE website_source = 'register') AS from_register
    FROM charities
  `);

  console.log(`\n═══ Overall DB State ═══`);
  console.log(`  Website from register:       ${summary[0].from_register}`);
  console.log(`  Website from email domain:   ${summary[0].from_email}`);
  console.log(`  Website from Tavily search:  ${summary[0].from_tavily}`);
  console.log(`  Still pending (no website):  ${summary[0].pending}`);

  await pool.end();
}

main().catch(err => {
  console.error('Discovery failed:', err);
  process.exit(1);
});
