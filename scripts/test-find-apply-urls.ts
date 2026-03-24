/**
 * Test: find application_form_url for first 10 grants that are missing it.
 * Uses Tavily extract on the grant's source_url to locate apply links.
 */

import { Pool } from '@neondatabase/serverless';
import { tavily } from '@tavily/core';

interface GrantRow {
  id: string;
  funder_name: string;
  name: string;
  source_url: string;
  url: string;
}

async function findApplyUrl(tc: ReturnType<typeof tavily>, openai: import('openai').default, grant: GrantRow): Promise<string | null> {
  try {
    // Strategy 1: Tavily extract on the source_url
    const targetUrl = grant.source_url || grant.url;
    let content = '';
    if (targetUrl) {
      const extractResult = await tc.extract([targetUrl]);
      content = extractResult.results?.[0]?.rawContent || '';
      console.log(`  [extract] ${content.length} chars from ${targetUrl}`);
    }

    // Strategy 2: Tavily search if extract returned nothing
    if (!content) {
      const query = `${grant.funder_name} "${grant.name}" apply online application`;
      const searchResult = await tc.search(query, { maxResults: 5, includeAnswer: false });
      content = searchResult.results?.map((r: { url: string; content: string }) => `URL: ${r.url}\n${r.content}`).join('\n\n') || '';
      console.log(`  [search] got ${searchResult.results?.length ?? 0} results for: ${query.slice(0, 60)}`);
    }

    if (!content) return null;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [{
        role: 'system',
        content: 'Find grant application URLs from web content. Return JSON only.',
      }, {
        role: 'user',
        content: `Find the direct URL where someone submits an application for the grant named "${grant.name}" from "${grant.funder_name}".

Look for: apply/apply now/apply here buttons, online application portals (smartygrants, fluxx, submittable, formstack, surveymonkey), application form links, or the funder's own apply page.

Return JSON: { "apply_url": "https://..." } or { "apply_url": null } if not clearly found.

Content:
${content.slice(0, 4000)}`,
      }],
    });

    const raw = (completion.choices[0]?.message?.content || '{}')
      .replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    console.log(`  [GPT] ${raw.slice(0, 150)}`);
    const parsed = JSON.parse(raw) as { apply_url?: string | null };
    const url = parsed.apply_url || null;
    // Validate it's a real URL with a host and path
    if (url) {
      try {
        const u = new URL(url);
        if (!u.hostname.includes('.')) { console.log(`  [skip] invalid URL: ${url}`); return null; }
      } catch { console.log(`  [skip] malformed URL: ${url}`); return null; }
    }
    return url;
  } catch (err) {
    console.error(`  Error for ${grant.name}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) { console.error('DATABASE_URL required'); process.exit(1); }
  if (!process.env.TAVILY_API_KEY) { console.error('TAVILY_API_KEY required'); process.exit(1); }
  if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY required'); process.exit(1); }

  const pool = new Pool({ connectionString: dbUrl });
  const tc = tavily({ apiKey: process.env.TAVILY_API_KEY! });
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const { rows: grants } = await pool.query<GrantRow>(`
    SELECT id, funder_name, name, source_url, url
    FROM grants
    WHERE is_active
      AND (application_form_url IS NULL OR application_form_url = '')
    ORDER BY id
    LIMIT 10
  `);

  console.log(`Testing ${grants.length} grants missing application_form_url\n`);

  let found = 0;
  for (const grant of grants) {
    console.log(`[${grant.id}] ${grant.funder_name} — ${grant.name}`);
    console.log(`  source_url: ${grant.source_url || '(none)'}`);

    const applyUrl = await findApplyUrl(tc, openai, grant);
    if (applyUrl) {
      found++;
      console.log(`  ✓ Found: ${applyUrl}`);
    } else {
      console.log(`  ✗ Not found`);
    }
    console.log();
  }

  console.log(`\nResult: ${found}/${grants.length} application URLs found and saved.`);
  await pool.end();
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
