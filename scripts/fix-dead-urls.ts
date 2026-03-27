/**
 * Fix dead and blocked application form URLs.
 *
 * 1. Dead (404) form URLs: Search for the current apply URL via Serper + Playwright
 * 2. Blocked (403) form URLs: Re-check with Playwright (stealth) to distinguish
 *    real blocks from bot detection
 * 3. Dead source URLs: Search for the funder's current grants page
 *
 * Usage:
 *   npx tsx scripts/fix-dead-urls.ts              # dry run
 *   npx tsx scripts/fix-dead-urls.ts --apply       # write fixes to DB
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { Pool } from '@neondatabase/serverless';
import { chromium, Browser } from 'playwright';
import OpenAI from 'openai';

const APPLY = process.argv.includes('--apply');
const CONCURRENCY = 10;
const NAVIGATE_TIMEOUT = 25_000;
const HEAD_TIMEOUT = 15_000;

// Exclude questionable replacements (landed on wrong pages)
const EXCLUDE_REPLACEMENTS = new Set([
  'https://www.trc.govt.nz/search/SearchForm?url=search%2FSearchForm&Search=building+consent&searchlocale=en_NZ&start=740',
  'https://www.otago.ac.nz/oerc/study',
]);

interface GrantRow {
  id: string;
  name: string;
  funder_name: string;
  source_url: string | null;
  application_form_url: string | null;
}

// ── URL checking ─────────────────────────────────────────────────────────────

async function headCheck(url: string): Promise<{ ok: boolean; code: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    clearTimeout(timer);
    return { ok: res.status >= 200 && res.status < 400, code: res.status };
  } catch {
    clearTimeout(timer);
    return { ok: false, code: null };
  }
}

// ── Playwright verification ──────────────────────────────────────────────────

async function playwrightCheck(
  context: Awaited<ReturnType<Browser['newContext']>>,
  url: string,
): Promise<{ ok: boolean; code: number | null; finalUrl: string | null }> {
  const page = await context.newPage();
  try {
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'networkidle', timeout: NAVIGATE_TIMEOUT });
    } catch {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATE_TIMEOUT });
    }
    const status = response?.status() || 0;
    const finalUrl = page.url();

    // Check if we landed on a real page (not an error page)
    const bodyText = await page.evaluate(() => {
      const body = document.querySelector('body');
      return (body?.innerText || '').slice(0, 500).toLowerCase();
    });

    const isErrorPage = bodyText.includes('page not found') ||
      bodyText.includes('404') ||
      bodyText.includes('no longer available') ||
      bodyText.includes('this page doesn\'t exist');

    return {
      ok: status >= 200 && status < 400 && !isErrorPage,
      code: status,
      finalUrl: finalUrl !== url ? finalUrl : null,
    };
  } catch {
    return { ok: false, code: null, finalUrl: null };
  } finally {
    await page.close();
  }
}

// ── Search for replacement URL ───────────────────────────────────────────────

async function searchForReplacementUrl(
  funderName: string,
  grantName: string,
  openai: OpenAI,
  context: Awaited<ReturnType<Browser['newContext']>>,
): Promise<string | null> {
  // Search for the grant's apply page
  const query = `"${funderName}" "${grantName}" apply application form`;
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 5, gl: 'nz' }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { organic?: { link: string; title?: string; snippet?: string }[] };
    const results = data.organic || [];
    if (results.length === 0) return null;

    // Check the top results with Playwright
    for (const r of results.slice(0, 3)) {
      const check = await playwrightCheck(context, r.link);
      if (check.ok) {
        // Check if this looks like an apply page
        const page = await context.newPage();
        try {
          await page.goto(r.link, { waitUntil: 'domcontentloaded', timeout: NAVIGATE_TIMEOUT });
          const text = await page.evaluate(() => {
            const body = document.querySelector('body');
            return (body?.innerText || '').slice(0, 2000).toLowerCase();
          });

          const isApplyPage = text.includes('apply') || text.includes('application') ||
            text.includes('submit') || text.includes('funding') || text.includes('grant');

          if (isApplyPage) {
            return check.finalUrl || r.link;
          }
        } catch {
          // skip
        } finally {
          await page.close();
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Search for replacement source URL ────────────────────────────────────────

async function searchForSourceUrl(
  funderName: string,
  context: Awaited<ReturnType<Browser['newContext']>>,
): Promise<string | null> {
  const query = `"${funderName}" grants funding apply`;
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 5, gl: 'nz' }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { organic?: { link: string }[] };
    const results = data.organic || [];

    for (const r of results.slice(0, 3)) {
      const check = await playwrightCheck(context, r.link);
      if (check.ok) return check.finalUrl || r.link;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) { console.error('DATABASE_URL required'); process.exit(1); }
  if (!process.env.SERPER_API_KEY) { console.error('SERPER_API_KEY required'); process.exit(1); }
  if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY required'); process.exit(1); }

  const pool = new Pool({ connectionString: dbUrl });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log(APPLY ? '*** APPLY MODE ***\n' : '*** DRY RUN ***\n');

  // Launch stealth browser
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-NZ',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // ── Part 1: Dead source URLs (404) ──────────────────────────────────────

  const deadSourceUrls = [
    'http://www.danielkeys.com',
    'https://www.thetrusts.co.nz/community/grants',
  ];

  console.log('=== Part 1: Dead source URLs ===\n');

  const { rows: deadSourceGrants } = await pool.query<GrantRow>(`
    SELECT id, name, funder_name, source_url, application_form_url
    FROM grants
    WHERE is_active AND source_url = ANY($1)
  `, [deadSourceUrls]);

  console.log(`${deadSourceGrants.length} grants with dead source URLs`);

  // Group by funder
  const byFunder = new Map<string, GrantRow[]>();
  for (const g of deadSourceGrants) {
    const grp = byFunder.get(g.funder_name) || [];
    grp.push(g);
    byFunder.set(g.funder_name, grp);
  }

  const sourceReplacements: { grantIds: string[]; funder: string; oldUrl: string; newUrl: string }[] = [];

  for (const [funder, grants] of byFunder) {
    console.log(`\n  Searching for ${funder}...`);
    const newUrl = await searchForSourceUrl(funder, context);
    if (newUrl) {
      console.log(`    Found: ${newUrl}`);
      sourceReplacements.push({
        grantIds: grants.map(g => g.id),
        funder,
        oldUrl: grants[0].source_url!,
        newUrl,
      });
    } else {
      console.log(`    No replacement found — will deactivate ${grants.length} grants`);
    }
  }

  // ── Part 2: Dead form URLs (404) ────────────────────────────────────────

  console.log('\n\n=== Part 2: Dead application form URLs ===\n');

  // Get all unique dead form URLs from the verification run
  const { rows: allFormGrants } = await pool.query<GrantRow>(`
    SELECT id, name, funder_name, source_url, application_form_url
    FROM grants
    WHERE is_active AND application_form_url IS NOT NULL AND application_form_url != ''
    ORDER BY funder_name
  `);

  // Check which form URLs are dead (404)
  const uniqueFormUrls = new Map<string, GrantRow[]>();
  for (const g of allFormGrants) {
    const grp = uniqueFormUrls.get(g.application_form_url!) || [];
    grp.push(g);
    uniqueFormUrls.set(g.application_form_url!, grp);
  }

  console.log(`Checking ${uniqueFormUrls.size} unique form URLs with HEAD requests...`);

  const deadFormUrls: string[] = [];
  const blockedFormUrls: string[] = [];
  const formUrlList = [...uniqueFormUrls.keys()];

  for (let i = 0; i < formUrlList.length; i += CONCURRENCY) {
    const chunk = formUrlList.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (url) => {
      const result = await headCheck(url);
      if (result.code === 404 || result.code === 410) {
        deadFormUrls.push(url);
      } else if (result.code === 403 || result.code === 401) {
        blockedFormUrls.push(url);
      }
    }));
    const done = Math.min(i + CONCURRENCY, formUrlList.length);
    process.stdout.write(`  HEAD check: ${done}/${formUrlList.length}\r`);
  }
  console.log('');

  console.log(`\n  Dead (404): ${deadFormUrls.length} unique URLs`);
  console.log(`  Blocked (403): ${blockedFormUrls.length} unique URLs\n`);

  // Search for replacements for dead form URLs
  const formReplacements: { grantId: string; grantName: string; funder: string; oldUrl: string; newUrl: string }[] = [];
  const formClears: { grantId: string; grantName: string; funder: string; oldUrl: string }[] = [];

  // Group dead form URLs by funder+grant for searching
  const deadFormGrants: GrantRow[] = [];
  for (const url of deadFormUrls) {
    deadFormGrants.push(...(uniqueFormUrls.get(url) || []));
  }

  console.log(`  Searching for replacements for ${deadFormGrants.length} grants with dead form URLs...\n`);

  for (let i = 0; i < deadFormGrants.length; i += CONCURRENCY) {
    const chunk = deadFormGrants.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (grant) => {
      const newUrl = await searchForReplacementUrl(grant.funder_name, grant.name, openai, context);
      if (newUrl && !EXCLUDE_REPLACEMENTS.has(newUrl)) {
        formReplacements.push({
          grantId: grant.id,
          grantName: grant.name,
          funder: grant.funder_name,
          oldUrl: grant.application_form_url!,
          newUrl,
        });
        console.log(`    ✓ ${grant.funder_name} — ${grant.name}`);
        console.log(`      ${grant.application_form_url} → ${newUrl}`);
      } else {
        formClears.push({
          grantId: grant.id,
          grantName: grant.name,
          funder: grant.funder_name,
          oldUrl: grant.application_form_url!,
        });
        console.log(`    ✗ ${grant.funder_name} — ${grant.name} (no replacement, will clear)`);
      }
    }));
  }

  // ── Part 3: Blocked form URLs — verify with Playwright ─────────────────

  console.log(`\n\n=== Part 3: Blocked form URLs (${blockedFormUrls.length}) — Playwright verification ===\n`);

  let blockedOk = 0, blockedDead = 0, blockedStillBlocked = 0;
  const blockedDeadUrls: string[] = [];

  for (let i = 0; i < blockedFormUrls.length; i += CONCURRENCY) {
    const chunk = blockedFormUrls.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (url) => {
      const result = await playwrightCheck(context, url);
      if (result.ok) {
        blockedOk++;
      } else if (result.code === 404 || result.code === 410 || (result.code && result.code >= 400 && result.code < 500 && result.code !== 403 && result.code !== 401)) {
        blockedDead++;
        blockedDeadUrls.push(url);
      } else {
        blockedStillBlocked++;
      }
    }));
    const done = Math.min(i + CONCURRENCY, blockedFormUrls.length);
    process.stdout.write(`  Playwright: ${done}/${blockedFormUrls.length} | ok: ${blockedOk} | dead: ${blockedDead} | still blocked: ${blockedStillBlocked}\r`);
  }
  console.log('');

  // For URLs that are truly dead even with Playwright, add to clears
  for (const url of blockedDeadUrls) {
    for (const g of uniqueFormUrls.get(url) || []) {
      formClears.push({
        grantId: g.id,
        grantName: g.name,
        funder: g.funder_name,
        oldUrl: url,
      });
    }
  }

  // ── Summary & Apply ────────────────────────────────────────────────────

  console.log('\n\n=== Summary ===\n');
  console.log(`Source URL replacements found:   ${sourceReplacements.length}`);
  console.log(`Form URL replacements found:     ${formReplacements.length}`);
  console.log(`Form URLs to clear (no replace): ${formClears.length}`);
  console.log(`Blocked URLs actually OK:        ${blockedOk}`);
  console.log(`Blocked URLs actually dead:      ${blockedDead}`);
  console.log(`Blocked URLs still uncertain:    ${blockedStillBlocked}`);

  const grantsToDeactivate = deadSourceGrants.filter(g =>
    !sourceReplacements.some(r => r.grantIds.includes(g.id))
  );
  if (grantsToDeactivate.length > 0) {
    console.log(`\nGrants to deactivate (dead source, no replacement): ${grantsToDeactivate.length}`);
    for (const g of grantsToDeactivate) {
      console.log(`  ${g.funder_name} — ${g.name}`);
    }
  }

  if (APPLY) {
    console.log('\nApplying changes...');

    // Update source URLs where we found replacements
    for (const r of sourceReplacements) {
      for (const grantId of r.grantIds) {
        await pool.query(
          `UPDATE grants SET source_url = $1, updated_at = NOW() WHERE id = $2`,
          [r.newUrl, grantId],
        );
      }
      console.log(`  Updated source URL for ${r.grantIds.length} ${r.funder} grants`);
    }

    // Deactivate grants with no source URL replacement
    for (const g of grantsToDeactivate) {
      await pool.query(
        `UPDATE grants SET is_active = false, updated_at = NOW() WHERE id = $1`,
        [g.id],
      );
    }
    if (grantsToDeactivate.length > 0) {
      console.log(`  Deactivated ${grantsToDeactivate.length} grants with dead source URLs`);
    }

    // Update form URLs where we found replacements
    for (const r of formReplacements) {
      await pool.query(
        `UPDATE grants SET application_form_url = $1, updated_at = NOW() WHERE id = $2`,
        [r.newUrl, r.grantId],
      );
    }
    if (formReplacements.length > 0) {
      console.log(`  Replaced ${formReplacements.length} dead form URLs`);
    }

    // Clear form URLs with no replacement
    for (const c of formClears) {
      await pool.query(
        `UPDATE grants SET application_form_url = NULL, updated_at = NOW() WHERE id = $1`,
        [c.grantId],
      );
    }
    if (formClears.length > 0) {
      console.log(`  Cleared ${formClears.length} dead form URLs`);
    }

    console.log('\nDone!');
  } else {
    console.log('\nDry run. Run with --apply to make changes.');
  }

  await browser.close();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
