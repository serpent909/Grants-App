/**
 * Pipeline Step 5: Targeted gap-filling for grants with low quality scores.
 *
 * Replaces: fill-missing-fields.ts, fill-missing-fields-tavily.ts,
 *           fill-grant-regions.ts, fill-apply-urls.ts, batch-deep-search.ts
 *
 * Only targets grants with data_quality_score < 60 (missing 2+ critical fields).
 *
 * Passes:
 *   1. Region inference (pattern-match funder names, no API calls)
 *   2. Tavily re-extraction (for missing eligibility, amount, deadline)
 *   3. Application URL search (Serper + Tavily for missing form URLs)
 *
 * Usage:
 *   DATABASE_URL="..." OPENAI_API_KEY="..." TAVILY_API_KEY="..." npx tsx scripts/pipeline/05-fill-gaps.ts
 *   ... --threshold N  # quality score threshold (default: 60)
 */

import {
  createPool, requireEnv, getFlagValue, logSection, logSummary,
} from '../../lib/pipeline/runner';
import { fetchPage, tavilySearch } from '../../lib/pipeline/fetcher';
import { extractMissingFields, type GapFillInput } from '../../lib/pipeline/extractor';
import { computeQualityScore, sanitiseRegions, VALID_REGIONS } from '../../lib/pipeline/quality';

requireEnv('OPENAI_API_KEY', 'TAVILY_API_KEY');

const THRESHOLD = parseInt(getFlagValue('--threshold') || '60');
const CONCURRENCY = 5;

// ─── Region inference patterns ──────────────────────────────────────────────

const REGION_PATTERNS: Array<{ pattern: RegExp; regions: string[] }> = [
  { pattern: /\bnorthland\b/i, regions: ['northland'] },
  { pattern: /\bauckland\b/i, regions: ['auckland'] },
  { pattern: /\bwaikato\b/i, regions: ['waikato'] },
  { pattern: /\b(bay of plenty|tauranga|rotorua)\b/i, regions: ['bay-of-plenty'] },
  { pattern: /\bgisborne\b/i, regions: ['gisborne'] },
  { pattern: /\b(hawke'?s? bay|hastings|napier)\b/i, regions: ['hawkes-bay'] },
  { pattern: /\btaranaki\b/i, regions: ['taranaki'] },
  { pattern: /\b(manawat[uū]|whanganui|palmerston north)\b/i, regions: ['manawatu-whanganui'] },
  { pattern: /\bwellington\b/i, regions: ['wellington'] },
  { pattern: /\btasman\b/i, regions: ['tasman'] },
  { pattern: /\bnelson\b/i, regions: ['nelson'] },
  { pattern: /\bmarlborough\b/i, regions: ['marlborough'] },
  { pattern: /\bwest coast\b/i, regions: ['west-coast'] },
  { pattern: /\b(canterbury|christchurch)\b/i, regions: ['canterbury'] },
  { pattern: /\b(otago|dunedin)\b/i, regions: ['otago'] },
  { pattern: /\bsouthland\b/i, regions: ['southland'] },
  // District/city councils
  { pattern: /\b(hamilton|waipa|waikato district)\b/i, regions: ['waikato'] },
  { pattern: /\b(lower hutt|upper hutt|porirua|kapiti)\b/i, regions: ['wellington'] },
];

function inferRegions(funderName: string): string[] | null {
  const matched = new Set<string>();
  for (const { pattern, regions } of REGION_PATTERNS) {
    if (pattern.test(funderName)) {
      regions.forEach(r => matched.add(r));
    }
  }
  return matched.size > 0 ? [...matched] : null;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const pool = createPool();

  // ═══ Pass 1: Region Inference ═══

  logSection('Pass 1: Region Inference (no API calls)');

  const { rows: noRegions } = await pool.query<{ id: string; funder_name: string }>(
    `SELECT id, funder_name FROM grants
     WHERE is_active AND pipeline_version = 2
       AND (regions IS NULL OR regions = '{}')
     ORDER BY funder_name`
  );

  let regionsInferred = 0;
  for (const g of noRegions) {
    const regions = inferRegions(g.funder_name);
    if (regions) {
      const sanitised = sanitiseRegions(regions);
      if (sanitised) {
        await pool.query(
          `UPDATE grants SET regions = $1,
           field_confidence = field_confidence || '{"regions": "inferred"}'::jsonb,
           updated_at = NOW()
           WHERE id = $2`,
          [sanitised, g.id]
        );
        regionsInferred++;
      }
    }
  }
  console.log(`  Inferred regions for ${regionsInferred} grants`);

  // ═══ Pass 2: Tavily Re-extraction ═══

  logSection('Pass 2: Tavily Re-extraction (low quality grants)');

  const { rows: lowQuality } = await pool.query<{
    id: string; name: string; funder_name: string; source_url: string;
    eligibility: string[] | null; amount_max: number | null; deadline: string | null;
    application_form_url: string | null; description: string | null;
    sectors: string[] | null; regions: string[] | null; key_contacts: string | null;
  }>(`SELECT id, name, funder_name, source_url, eligibility, amount_max, deadline,
            application_form_url, description, sectors, regions, key_contacts
      FROM grants
      WHERE is_active AND pipeline_version = 2
        AND data_quality_score < $1
        AND source_url IS NOT NULL
      ORDER BY data_quality_score ASC`, [THRESHOLD]);

  console.log(`  ${lowQuality.length} grants below quality threshold ${THRESHOLD}`);

  // Group by source_url to minimize fetches
  const byUrl = new Map<string, typeof lowQuality>();
  for (const g of lowQuality) {
    const url = g.source_url;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url)!.push(g);
  }

  let fieldsUpdated = 0;
  const urls = [...byUrl.keys()];

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(async url => {
      const grants = byUrl.get(url)!;

      // Fetch the page
      const pageResult = await fetchPage(url);
      if (!pageResult) return 0;

      // Determine which fields are missing for each grant
      const inputs: GapFillInput[] = grants.map(g => {
        const missing: string[] = [];
        if (!g.eligibility || g.eligibility.length < 2) missing.push('eligibility');
        if (g.amount_max == null) missing.push('amount_min', 'amount_max');
        if (!g.deadline) missing.push('deadline');
        if (!g.application_form_url) missing.push('application_form_url');
        if (!g.key_contacts) missing.push('key_contacts');
        return { grant_id: g.id, grant_name: g.name, funder_name: g.funder_name, missing_fields: missing };
      }).filter(g => g.missing_fields.length > 0);

      if (inputs.length === 0) return 0;

      const extracted = await extractMissingFields(inputs, url, pageResult.content, 'gpt-4o');

      let count = 0;
      for (const result of extracted) {
        const grant = grants.find(g => g.id === result.grant_id);
        if (!grant) continue;

        // Only update NULL fields (COALESCE pattern)
        const updates: string[] = [];
        const values: unknown[] = [];
        let paramIdx = 1;

        if (result.eligibility?.length && (!grant.eligibility || grant.eligibility.length < 2)) {
          updates.push(`eligibility = COALESCE(eligibility, $${paramIdx})`);
          values.push(result.eligibility);
          paramIdx++;
        }
        if (result.amount_min != null && grant.amount_max == null) {
          updates.push(`amount_min = COALESCE(amount_min, $${paramIdx})`);
          values.push(result.amount_min);
          paramIdx++;
        }
        if (result.amount_max != null && grant.amount_max == null) {
          updates.push(`amount_max = COALESCE(amount_max, $${paramIdx})`);
          values.push(result.amount_max);
          paramIdx++;
        }
        if (result.deadline && !grant.deadline) {
          updates.push(`deadline = COALESCE(deadline, $${paramIdx})`);
          values.push(result.deadline);
          paramIdx++;
        }
        if (result.application_form_url && !grant.application_form_url) {
          updates.push(`application_form_url = COALESCE(application_form_url, $${paramIdx})`);
          values.push(result.application_form_url);
          paramIdx++;
        }
        if (result.key_contacts && !grant.key_contacts) {
          updates.push(`key_contacts = COALESCE(key_contacts, $${paramIdx})`);
          values.push(result.key_contacts);
          paramIdx++;
        }

        if (updates.length > 0) {
          values.push(grant.id);
          await pool.query(
            `UPDATE grants SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIdx}`,
            values
          );
          count++;
        }
      }
      return count;
    }));

    for (const r of results) {
      if (r.status === 'fulfilled') fieldsUpdated += r.value;
    }

    const done = Math.min(i + CONCURRENCY, urls.length);
    console.log(`  Progress: ${done}/${urls.length} URLs processed | ${fieldsUpdated} grants updated`);
  }

  // ═══ Pass 3: Application URL Search ═══

  logSection('Pass 3: Application URL Search');

  const { rows: noFormUrl } = await pool.query<{ id: string; name: string; funder_name: string; source_url: string }>(
    `SELECT id, name, funder_name, source_url FROM grants
     WHERE is_active AND pipeline_version = 2
       AND application_form_url IS NULL AND source_url IS NOT NULL
     ORDER BY data_quality_score DESC
     LIMIT 500`
  );

  console.log(`  ${noFormUrl.length} grants missing application form URL`);

  let formUrlsFound = 0;
  for (let i = 0; i < noFormUrl.length; i += CONCURRENCY) {
    const batch = noFormUrl.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(async g => {
      const query = `"${g.funder_name}" "${g.name}" apply application form NZ`;
      const searchResults = await tavilySearch(query, 3);

      // Look for known portal domains
      const portalDomains = ['smartygrants.com.au', 'fluxx.io', 'surveymonkey.com', 'google.com', 'typeform.com'];
      for (const sr of searchResults) {
        try {
          const host = new URL(sr.url).hostname.replace(/^www\./, '');
          const isPortal = portalDomains.some(d => host.includes(d));
          const isSameDomain = g.source_url && host === new URL(g.source_url).hostname.replace(/^www\./, '');
          if (isPortal || isSameDomain) {
            await pool.query(
              `UPDATE grants SET application_form_url = $1,
               field_confidence = field_confidence || '{"application_form_url": "extracted"}'::jsonb,
               updated_at = NOW()
               WHERE id = $2 AND application_form_url IS NULL`,
              [sr.url, g.id]
            );
            return true;
          }
        } catch { /* invalid URL */ }
      }
      return false;
    }));

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) formUrlsFound++;
    }
  }
  console.log(`  Found ${formUrlsFound} application form URLs`);

  // ═══ Recompute quality scores ═══

  logSection('Recomputing Quality Scores');

  const { rows: allActive } = await pool.query<{
    id: string; description: string | null; eligibility: string[] | null;
    amount_max: number | null; deadline: string | null;
    application_form_url: string | null; sectors: string[] | null;
    regions: string[] | null; key_contacts: string | null;
  }>(`SELECT id, description, eligibility, amount_max, deadline,
            application_form_url, sectors, regions, key_contacts
      FROM grants WHERE is_active AND pipeline_version = 2`);

  for (const g of allActive) {
    const score = computeQualityScore(g);
    await pool.query(`UPDATE grants SET data_quality_score = $1 WHERE id = $2`, [score, g.id]);
  }
  console.log(`  Recomputed scores for ${allActive.length} grants`);

  // ═══ Coverage Report ═══

  logSection('Coverage Report');
  const { rows: coverage } = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE description IS NOT NULL AND length(description) > 50) AS with_description,
      COUNT(*) FILTER (WHERE eligibility IS NOT NULL AND array_length(eligibility, 1) >= 2) AS with_eligibility,
      COUNT(*) FILTER (WHERE amount_max IS NOT NULL) AS with_amount,
      COUNT(*) FILTER (WHERE deadline IS NOT NULL) AS with_deadline,
      COUNT(*) FILTER (WHERE application_form_url IS NOT NULL) AS with_form_url,
      COUNT(*) FILTER (WHERE sectors IS NOT NULL AND array_length(sectors, 1) >= 1) AS with_sectors,
      COUNT(*) FILTER (WHERE regions IS NOT NULL AND array_length(regions, 1) >= 1) AS with_regions,
      AVG(data_quality_score)::integer AS avg_quality
    FROM grants WHERE is_active AND pipeline_version = 2
  `);

  const c = coverage[0];
  const total = Number(c.total);
  const pct = (n: number) => total > 0 ? `${(n / total * 100).toFixed(1)}%` : '0%';

  logSummary({
    'Total active v2 grants': total,
    'Avg quality score': c.avg_quality,
    [`description (target ≥95%)`]: `${c.with_description} (${pct(Number(c.with_description))})`,
    [`eligibility (target ≥80%)`]: `${c.with_eligibility} (${pct(Number(c.with_eligibility))})`,
    [`amount_max (target ≥60%)`]: `${c.with_amount} (${pct(Number(c.with_amount))})`,
    [`deadline (target ≥55%)`]: `${c.with_deadline} (${pct(Number(c.with_deadline))})`,
    [`form_url (target ≥40%)`]: `${c.with_form_url} (${pct(Number(c.with_form_url))})`,
    [`sectors (target ≥90%)`]: `${c.with_sectors} (${pct(Number(c.with_sectors))})`,
    [`regions (target ≥70%)`]: `${c.with_regions} (${pct(Number(c.with_regions))})`,
    'Regions inferred (Pass 1)': regionsInferred,
    'Fields updated (Pass 2)': fieldsUpdated,
    'Form URLs found (Pass 3)': formUrlsFound,
  });

  await pool.end();
}

main().catch(err => { console.error('Pipeline step 5 failed:', err); process.exit(1); });
