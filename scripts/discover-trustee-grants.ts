/**
 * Discover individual trust grant pages from Public Trust and Perpetual Guardian.
 * These trustee companies each administer dozens of small charitable trusts.
 *
 * Outputs new URLs that can be added to curatedFunderUrls in lib/markets/nz.ts
 *
 * Usage:
 *   npx tsx scripts/discover-trustee-grants.ts
 */
import { NZ_MARKET } from '../lib/markets/nz';

const TRUSTEE_PAGES = [
  {
    name: 'Public Trust',
    url: 'https://www.publictrust.co.nz/grants/',
    pattern: /https?:\/\/www\.publictrust\.co\.nz\/grants\/[a-z0-9-]+\/?/gi,
  },
  {
    name: 'Perpetual Guardian',
    url: 'https://www.perpetualguardian.co.nz/philanthropy/grant-seekers/grants-open-upcoming/',
    pattern: /https?:\/\/www\.perpetualguardian\.co\.nz\/philanthropy\/[a-z0-9/-]+/gi,
  },
];

// Normalise for comparison
function normaliseUrl(u: string): string {
  try {
    const url = new URL(u);
    return (url.origin + url.pathname).replace(/\/+$/, '').toLowerCase();
  } catch {
    return u.toLowerCase().replace(/\/+$/, '');
  }
}

async function main() {
  // Build set of already-curated URLs
  const existing = new Set(
    NZ_MARKET.curatedFunderUrls.map(e => normaliseUrl(e.url))
  );

  let totalNew = 0;

  for (const trustee of TRUSTEE_PAGES) {
    console.log(`\n=== ${trustee.name} ===`);
    console.log(`Fetching: ${trustee.url}`);

    try {
      const res = await fetch(trustee.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrantSearch/1.0)' },
      });
      if (!res.ok) {
        console.log(`  HTTP ${res.status} — skipping`);
        continue;
      }

      const html = await res.text();

      // Extract all links matching the trustee's grant page pattern
      const matches = html.match(trustee.pattern) || [];
      const unique = [...new Set(matches.map(normaliseUrl))];

      // Filter out already-curated and top-level pages
      const topLevel = normaliseUrl(trustee.url);
      const newUrls = unique.filter(u =>
        u !== topLevel &&
        !existing.has(u) &&
        u.split('/').filter(Boolean).length > 3 // must be a sub-page, not just /grants/
      );

      console.log(`  Found ${unique.length} grant page links, ${newUrls.length} new`);

      for (const url of newUrls.sort()) {
        console.log(`    { url: '${url}/' },`);
        totalNew++;
      }
    } catch (err) {
      console.error(`  Error fetching ${trustee.url}:`, err);
    }
  }

  console.log(`\nTotal new URLs discovered: ${totalNew}`);
  console.log('Review the output above and add relevant entries to curatedFunderUrls in lib/markets/nz.ts');
}

main().catch(e => { console.error(e); process.exit(1); });
