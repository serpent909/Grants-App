/**
 * Enrich charity records with grant page URLs and funding summaries.
 *
 * Usage:
 *   DATABASE_URL="postgres://..." OPENAI_API_KEY="sk-..." npx tsx scripts/enrich-charities.ts
 *
 * What it does:
 *   1. Fetches each charity's homepage
 *   2. Parses links to find grant/funding pages
 *   3. Fetches the best grant page
 *   4. Uses GPT to summarize what they fund
 *   5. Stores the grant URL + summary back in the DB
 *
 * Safe to re-run — only processes unenriched records (enriched_at IS NULL).
 * Use --force to re-enrich all records.
 */

import { Pool } from '@neondatabase/serverless';
import OpenAI from 'openai';

const CONCURRENCY = 5;
const FETCH_TIMEOUT = 10000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Keywords to look for in link text or href to identify grant pages
const GRANT_LINK_KEYWORDS = /grant|fund|appli|apply|eligib|criteria|what.we.fund|what.we.support|how.to.apply|community.support/i;
// Stronger signal — these in the link text are very likely grant pages
const STRONG_LINK_KEYWORDS = /\bgrant|apply\s*(for|now)|funding\s*(available|round|application)|how\s*to\s*apply|what\s*we\s*fund/i;

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) { console.error('DATABASE_URL is required'); process.exit(1); }
  if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY is required'); process.exit(1); }

  const pool = new Pool({ connectionString: dbUrl });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const force = process.argv.includes('--force');

  // Ensure enrichment columns exist
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS grant_url TEXT`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS grant_summary TEXT`);
  await pool.query(`ALTER TABLE charities ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMP`);

  // Fetch unenriched charities
  const condition = force ? '' : 'AND enriched_at IS NULL';
  const { rows: charities } = await pool.query(
    `SELECT id, name, website_url, purpose FROM charities WHERE website_url IS NOT NULL ${condition} ORDER BY id`
  );

  console.log(`Found ${charities.length} charities to enrich${force ? ' (force mode)' : ''}`);
  if (charities.length === 0) { await pool.end(); return; }

  let enriched = 0;
  let failed = 0;
  let noGrantPage = 0;

  for (let i = 0; i < charities.length; i += CONCURRENCY) {
    const batch = charities.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(c => enrichCharity(c, pool, openai)));

    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value === 'enriched') enriched++;
        else noGrantPage++;
      } else {
        failed++;
      }
    }

    console.log(`Progress: ${Math.min(i + CONCURRENCY, charities.length)}/${charities.length} (enriched: ${enriched}, no grant page: ${noGrantPage}, failed: ${failed})`);
  }

  console.log(`\nDone! Enriched: ${enriched}, No grant page: ${noGrantPage}, Failed: ${failed}`);

  const { rows } = await pool.query('SELECT COUNT(*) AS total FROM charities WHERE grant_summary IS NOT NULL');
  console.log(`Total enriched records: ${rows[0].total}`);

  await pool.end();
}

interface FoundLink {
  href: string;
  text: string;
  score: number;
}

/**
 * Fetch homepage HTML, parse all <a> tags, score them for grant relevance,
 * and return the best grant page URL + the homepage content as fallback.
 */
async function findGrantPage(
  baseUrl: string,
  charityName: string,
): Promise<{ grantUrl: string | null; grantContent: string | null; homepageContent: string | null }> {
  let homepageHtml: string;
  try {
    const res = await fetch(baseUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) {
      console.log(`  ✗ ${charityName}: HTTP ${res.status} from ${baseUrl}`);
      return { grantUrl: null, grantContent: null, homepageContent: null };
    }
    homepageHtml = await res.text();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${charityName}: ${msg.slice(0, 80)}`);
    return { grantUrl: null, grantContent: null, homepageContent: null };
  }

  const homepageText = stripHtml(homepageHtml);

  // Parse all links from the homepage
  const linkRegex = /<a\s[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const links: FoundLink[] = [];
  let match;

  while ((match = linkRegex.exec(homepageHtml)) !== null) {
    const rawHref = match[1].trim();
    const linkText = match[2].replace(/<[^>]+>/g, '').trim();

    // Resolve relative URLs
    let fullUrl: string;
    try {
      fullUrl = new URL(rawHref, baseUrl).href;
    } catch { continue; }

    // Only follow links on the same domain
    try {
      const linkHost = new URL(fullUrl).hostname;
      const baseHost = new URL(baseUrl).hostname;
      if (linkHost !== baseHost) continue;
    } catch { continue; }

    // Score this link for grant relevance
    let score = 0;
    const hrefLower = rawHref.toLowerCase();
    const textLower = linkText.toLowerCase();

    // Score based on link text
    if (STRONG_LINK_KEYWORDS.test(textLower)) score += 10;
    else if (GRANT_LINK_KEYWORDS.test(textLower)) score += 5;

    // Score based on href path
    if (STRONG_LINK_KEYWORDS.test(hrefLower)) score += 8;
    else if (GRANT_LINK_KEYWORDS.test(hrefLower)) score += 4;

    // Penalise generic nav links
    if (textLower === 'home' || textLower === 'about' || textLower === 'contact') score -= 10;

    if (score > 0) {
      links.push({ href: fullUrl, text: linkText, score });
    }
  }

  // Sort by score, pick the best
  links.sort((a, b) => b.score - a.score);

  if (links.length > 0) {
    const best = links[0];
    // Fetch the grant page
    try {
      const res = await fetch(best.href, {
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
        headers: { 'User-Agent': UA },
      });
      if (res.ok) {
        const html = await res.text();
        const text = stripHtml(html).slice(0, 4000);
        console.log(`  ✓ ${charityName}: found grant link "${best.text}" → ${best.href.replace(baseUrl, '')}`);
        return { grantUrl: best.href, grantContent: text, homepageContent: homepageText };
      }
    } catch { /* fall through to homepage */ }
  }

  // No grant link found — check if homepage itself has grant content
  if (homepageText.toLowerCase().includes('grant') || homepageText.toLowerCase().includes('fund')) {
    console.log(`  ✓ ${charityName}: no grant links found, using homepage content`);
    return { grantUrl: baseUrl, grantContent: homepageText.slice(0, 4000), homepageContent: homepageText };
  }

  console.log(`  ✗ ${charityName}: no grant links or keywords found`);
  return { grantUrl: null, grantContent: null, homepageContent: homepageText };
}

async function enrichCharity(
  charity: { id: number; name: string; website_url: string; purpose: string | null },
  pool: Pool,
  openai: OpenAI,
): Promise<'enriched' | 'no-grant-page'> {
  const baseUrl = charity.website_url.replace(/\/+$/, '');

  const { grantUrl, grantContent } = await findGrantPage(baseUrl, charity.name);

  if (!grantContent) {
    await pool.query(
      `UPDATE charities SET enriched_at = NOW() WHERE id = $1`,
      [charity.id]
    );
    return 'no-grant-page';
  }

  // Use GPT to summarize what they fund
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Based on this webpage content from "${charity.name}", write a concise 2-3 sentence summary of what grants/funding they offer. Include: who can apply, what they fund, typical grant sizes if mentioned, and any geographic focus. If the content doesn't describe specific grants, say "No specific grant information found."

Charity purpose from register: ${charity.purpose || 'Not specified'}

Webpage content:
${grantContent}`
      }],
    });

    const summary = completion.choices[0]?.message?.content?.trim() || null;

    if (summary && !summary.includes('No specific grant information found')) {
      await pool.query(
        `UPDATE charities SET grant_url = $1, grant_summary = $2, enriched_at = NOW() WHERE id = $3`,
        [grantUrl, summary, charity.id]
      );
      console.log(`  ★ ${charity.name}: ENRICHED — ${summary.slice(0, 100)}...`);
      return 'enriched';
    } else {
      console.log(`  ○ ${charity.name}: GPT said no specific grant info`);
      await pool.query(
        `UPDATE charities SET enriched_at = NOW() WHERE id = $1`,
        [charity.id]
      );
      return 'no-grant-page';
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${charity.name}: GPT error — ${msg.slice(0, 100)}`);
    await pool.query(
      `UPDATE charities SET enriched_at = NOW() WHERE id = $1`,
      [charity.id]
    );
    return 'no-grant-page';
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

main().catch(err => {
  console.error('Enrichment failed:', err);
  process.exit(1);
});
