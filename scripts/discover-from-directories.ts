/**
 * Discover new funder URLs from grant directories and trustee pages.
 * Uses Tavily extract for JS-rendered pages, raw fetch for static HTML.
 *
 * Usage:
 *   npx tsx scripts/discover-from-directories.ts
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { NZ_MARKET } from '../lib/markets/nz';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
if (!TAVILY_API_KEY) { console.error('TAVILY_API_KEY required'); process.exit(1); }

// Pages to scrape for funder links
const DISCOVERY_TARGETS = [
  {
    name: 'Public Trust Grants',
    url: 'https://www.publictrust.co.nz/grants/',
    useTavily: true,
  },
  {
    name: 'Perpetual Guardian - Open Grants',
    url: 'https://www.perpetualguardian.co.nz/philanthropy/grant-seekers/grants-open-upcoming/',
    useTavily: true,
  },
  {
    name: 'DOC - Other Funding Organisations',
    url: 'https://www.doc.govt.nz/get-involved/funding/other-funding-organisations/',
    useTavily: false,
  },
  {
    name: 'Tindall Foundation - Other Funding Resources',
    url: 'https://tindall.org.nz/other-funding-resources/',
    useTavily: false,
  },
  {
    name: 'Philanthropy NZ - Our Members',
    url: 'https://www.philanthropy.org.nz/our-members',
    useTavily: true,
  },
];

function normaliseUrl(u: string): string {
  try {
    const url = new URL(u);
    return (url.origin + url.pathname).replace(/\/+$/, '').toLowerCase();
  } catch {
    return u.toLowerCase().replace(/\/+$/, '');
  }
}

function extractUrls(text: string): string[] {
  const urlPattern = /https?:\/\/[^\s"'<>)\]]+/g;
  const matches = text.match(urlPattern) || [];
  // Clean trailing punctuation
  return matches.map(u => u.replace(/[.,;:!?)]+$/, ''));
}

async function fetchWithTavily(url: string): Promise<string> {
  const res = await fetch('https://api.tavily.com/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      urls: [url],
    }),
  });
  const data = await res.json();
  return data.results?.[0]?.raw_content || data.results?.[0]?.text || '';
}

async function fetchRaw(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrantSearch/1.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main() {
  // Build set of already-curated hostnames for dedup
  const existingHostnames = new Set(
    NZ_MARKET.curatedFunderUrls.map(e => {
      try { return new URL(e.url).hostname.replace(/^www\./, ''); } catch { return ''; }
    }).filter(Boolean)
  );
  const existingUrls = new Set(
    NZ_MARKET.curatedFunderUrls.map(e => normaliseUrl(e.url))
  );

  const allDiscovered: { source: string; url: string; hostname: string }[] = [];

  for (const target of DISCOVERY_TARGETS) {
    console.log(`\n=== ${target.name} ===`);
    console.log(`  Fetching: ${target.url}`);

    try {
      const content = target.useTavily
        ? await fetchWithTavily(target.url)
        : await fetchRaw(target.url);

      const urls = extractUrls(content);
      const unique = [...new Set(urls.map(normaliseUrl))];

      // Filter to NZ-ish domains that look like funder pages
      const candidates = unique.filter(u => {
        try {
          const hostname = new URL(u).hostname.replace(/^www\./, '');
          // Skip internal links, social media, news sites, known non-funders
          const skipDomains = [
            'facebook.com', 'twitter.com', 'linkedin.com', 'youtube.com',
            'instagram.com', 'wikipedia.org', 'google.com', 'nzherald.co.nz',
            'stuff.co.nz', 'charities.govt.nz', 'register.charities.govt.nz',
            'philanthropy.org.nz', 'tindall.org.nz', 'publictrust.co.nz',
            'perpetualguardian.co.nz', 'doc.govt.nz', 'tavily.com',
          ];
          if (skipDomains.some(d => hostname.includes(d))) return false;
          // Skip if already curated (by hostname)
          if (existingHostnames.has(hostname)) return false;
          if (existingUrls.has(normaliseUrl(u))) return false;
          return true;
        } catch { return false; }
      });

      console.log(`  Found ${unique.length} URLs, ${candidates.length} new candidates`);

      for (const u of candidates) {
        const hostname = new URL(u).hostname.replace(/^www\./, '');
        console.log(`    ${hostname.padEnd(40)} ${u}`);
        allDiscovered.push({ source: target.name, url: u, hostname });
      }
    } catch (err) {
      console.error(`  Error: ${err}`);
    }
  }

  // Deduplicate by hostname across all sources
  const byHostname = new Map<string, typeof allDiscovered[0]>();
  for (const d of allDiscovered) {
    if (!byHostname.has(d.hostname)) byHostname.set(d.hostname, d);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY: ${byHostname.size} unique new funders discovered`);
  console.log(`${'='.repeat(60)}`);

  for (const [hostname, d] of [...byHostname].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  { url: '${d.url}' },  // via ${d.source}`);
  }

  console.log('\nReview the output above and add relevant entries to curatedFunderUrls in lib/markets/nz.ts');
}

main().catch(e => { console.error(e); process.exit(1); });
