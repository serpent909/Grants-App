/**
 * Verify active grant URLs are still live.
 *
 * Strategy:
 *   1. HEAD request on source_url for all active grants (grouped by URL to avoid duplicates)
 *   2. For 404/410 responses → deactivate the grant
 *   3. For 403/5xx → skip (could be bot-blocking, not dead)
 *   4. For connection errors (ENOTFOUND, ECONNREFUSED) → deactivate (dead domain)
 *   5. Optionally verify application_form_url too (--check-form-urls)
 *
 * Usage:
 *   npx tsx scripts/verify-grant-urls.ts                # dry run
 *   npx tsx scripts/verify-grant-urls.ts --apply        # deactivate dead grants
 *   npx tsx scripts/verify-grant-urls.ts --apply --check-form-urls  # also check form URLs
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { Pool } from '@neondatabase/serverless';

const APPLY = process.argv.includes('--apply');
const CHECK_FORM_URLS = process.argv.includes('--check-form-urls');
const CONCURRENCY = 25;
const TIMEOUT = 15_000;

interface GrantRow {
  id: string;
  name: string;
  funder_name: string;
  source_url: string;
  application_form_url: string | null;
}

type UrlStatus = 'ok' | 'dead' | 'blocked' | 'error';

async function checkUrl(url: string): Promise<{ status: UrlStatus; code: number | null; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    // Try HEAD first, fall back to GET (some servers reject HEAD)
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      });
    } catch {
      // HEAD failed, try GET
      res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      });
    }

    clearTimeout(timer);

    if (res.status === 404 || res.status === 410) {
      return { status: 'dead', code: res.status };
    }
    if (res.status === 403 || res.status === 401 || res.status >= 500) {
      return { status: 'blocked', code: res.status };
    }
    return { status: 'ok', code: res.status };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);

    // Dead domain / connection refused → definitely dead
    if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('ERR_NAME_NOT_RESOLVED')) {
      return { status: 'dead', code: null, error: msg.slice(0, 80) };
    }
    // Timeouts and other errors → uncertain, don't deactivate
    return { status: 'error', code: null, error: msg.slice(0, 80) };
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) { console.error('DATABASE_URL required'); process.exit(1); }

  const pool = new Pool({ connectionString: dbUrl });

  const { rows: grants } = await pool.query<GrantRow>(`
    SELECT id, name, funder_name, source_url, application_form_url
    FROM grants
    WHERE is_active AND source_url IS NOT NULL
    ORDER BY funder_name, name
  `);

  console.log(`${grants.length} active grants to verify`);
  console.log(APPLY ? '*** APPLY MODE ***\n' : '*** DRY RUN ***\n');

  // Group by source_url to avoid checking same URL multiple times
  const byUrl = new Map<string, GrantRow[]>();
  for (const g of grants) {
    const grp = byUrl.get(g.source_url) || [];
    grp.push(g);
    byUrl.set(g.source_url, grp);
  }

  console.log(`${byUrl.size} unique source URLs to check\n`);

  const deadGrants: { id: string; name: string; funder: string; url: string; reason: string }[] = [];
  const deadFormUrls: { id: string; name: string; url: string; reason: string }[] = [];
  let checked = 0, ok = 0, dead = 0, blocked = 0, errors = 0;

  const urls = [...byUrl.keys()];
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const chunk = urls.slice(i, i + CONCURRENCY);

    await Promise.all(chunk.map(async (url) => {
      const result = await checkUrl(url);
      checked++;

      const affectedGrants = byUrl.get(url)!;

      if (result.status === 'dead') {
        dead++;
        for (const g of affectedGrants) {
          deadGrants.push({
            id: g.id,
            name: g.name,
            funder: g.funder_name,
            url,
            reason: result.code ? `HTTP ${result.code}` : (result.error || 'dead'),
          });
        }
      } else if (result.status === 'blocked') {
        blocked++;
      } else if (result.status === 'error') {
        errors++;
      } else {
        ok++;
      }
    }));

    const done = Math.min(i + CONCURRENCY, urls.length);
    process.stdout.write(`  Source URLs: ${done}/${urls.length} | ok: ${ok} | dead: ${dead} | blocked: ${blocked} | errors: ${errors}\r`);
  }
  console.log('');

  // Optionally check application_form_urls too
  if (CHECK_FORM_URLS) {
    const formGrants = grants.filter(g => g.application_form_url);
    const uniqueFormUrls = new Map<string, GrantRow[]>();
    for (const g of formGrants) {
      const grp = uniqueFormUrls.get(g.application_form_url!) || [];
      grp.push(g);
      uniqueFormUrls.set(g.application_form_url!, grp);
    }

    console.log(`\nChecking ${uniqueFormUrls.size} unique application form URLs...`);
    let formOk = 0, formDead = 0, formBlocked = 0, formErrors = 0;

    const formUrlList = [...uniqueFormUrls.keys()];
    for (let i = 0; i < formUrlList.length; i += CONCURRENCY) {
      const chunk = formUrlList.slice(i, i + CONCURRENCY);

      await Promise.all(chunk.map(async (url) => {
        const result = await checkUrl(url);

        if (result.status === 'dead') {
          formDead++;
          for (const g of uniqueFormUrls.get(url)!) {
            deadFormUrls.push({
              id: g.id,
              name: g.name,
              url,
              reason: result.code ? `HTTP ${result.code}` : (result.error || 'dead'),
            });
          }
        } else if (result.status === 'blocked') {
          formBlocked++;
        } else if (result.status === 'error') {
          formErrors++;
        } else {
          formOk++;
        }
      }));

      const done = Math.min(i + CONCURRENCY, formUrlList.length);
      process.stdout.write(`  Form URLs: ${done}/${formUrlList.length} | ok: ${formOk} | dead: ${formDead} | blocked: ${formBlocked}\r`);
    }
    console.log('');
  }

  // Report dead source URLs
  if (deadGrants.length > 0) {
    console.log(`\n${deadGrants.length} grants with dead source URLs:\n`);
    for (const g of deadGrants) {
      console.log(`  ${g.funder.padEnd(40)} ${g.name}`);
      console.log(`    ${g.url} — ${g.reason}`);
    }
  } else {
    console.log('\nNo dead source URLs found.');
  }

  // Report dead form URLs
  if (deadFormUrls.length > 0) {
    console.log(`\n${deadFormUrls.length} grants with dead application form URLs:\n`);
    for (const g of deadFormUrls) {
      console.log(`  ${g.name}`);
      console.log(`    ${g.url} — ${g.reason}`);
    }
  }

  // Apply changes
  if (APPLY && deadGrants.length > 0) {
    let deactivated = 0;
    for (const g of deadGrants) {
      await pool.query(
        `UPDATE grants SET is_active = false, updated_at = NOW() WHERE id = $1`,
        [g.id],
      );
      deactivated++;
    }
    console.log(`\nDeactivated ${deactivated} grants with dead source URLs.`);
  }

  if (APPLY && deadFormUrls.length > 0) {
    let cleared = 0;
    for (const g of deadFormUrls) {
      await pool.query(
        `UPDATE grants SET application_form_url = NULL, updated_at = NOW() WHERE id = $1`,
        [g.id],
      );
      cleared++;
    }
    console.log(`Cleared ${cleared} dead application form URLs.`);
  }

  if (!APPLY && (deadGrants.length > 0 || deadFormUrls.length > 0)) {
    console.log(`\nDry run. Run with --apply to deactivate ${deadGrants.length} grants and clear ${deadFormUrls.length} form URLs.`);
  }

  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`  Source URLs checked: ${checked}`);
  console.log(`    OK:      ${ok}`);
  console.log(`    Dead:    ${dead} (${deadGrants.length} grants affected)`);
  console.log(`    Blocked: ${blocked} (skipped — likely bot detection)`);
  console.log(`    Errors:  ${errors} (skipped — timeouts etc)`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
