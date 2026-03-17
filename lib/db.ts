import { Pool } from '@neondatabase/serverless';
import { SearchResult } from './types';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL or POSTGRES_URL env var is required');
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

// Map Charities Register sector IDs → our app sector IDs
const REGISTER_SECTOR_MAP: Record<number, string[]> = {
  1:  ['housing'],
  2:  ['arts-culture'],
  4:  ['community'],
  5:  ['disability'],
  7:  ['education'],
  8:  ['community'],
  10: ['environment'],
  12: ['health'],
  16: ['social-services'],
  17: ['sport'],
};

/**
 * Find grant-giving charities from the DB that match the user's sectors and purpose.
 * Returns up to `limit` results ranked by relevance.
 * Gracefully returns [] if the DB is unavailable or not configured.
 */
export async function findMatchingCharities(
  sectors: string[],
  regionNames: string[],
  purpose: string,
  limit = 200,
): Promise<{ name: string; url: string; grantUrl: string | null; purpose: string; grantSummary: string | null }[]> {
  // Skip if no DB configured
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) return [];

  try {
    const db = getPool();

    // Map our sector IDs to register sector IDs for direct filtering
    const registerSectorIds: number[] = [];
    for (const [regId, appSectors] of Object.entries(REGISTER_SECTOR_MAP)) {
      if (appSectors.some(s => sectors.includes(s))) {
        registerSectorIds.push(Number(regId));
      }
    }

    // Build full-text search terms from purpose + region names
    const purposeWords = purpose
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 10);
    const allTerms = purposeWords.concat(regionNames.map(r => r.replace(/\s+/g, '')));
    const seen = new Map<string, boolean>();
    const searchTerms: string[] = [];
    for (const t of allTerms) {
      const key = t.toLowerCase();
      if (!seen.has(key)) { seen.set(key, true); searchTerms.push(t); }
    }
    const tsQuery = searchTerms.map(t => t.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean).join(' | ');

    if (!tsQuery && registerSectorIds.length === 0) return [];

    // Build query with parameterized conditions
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (registerSectorIds.length > 0) {
      conditions.push(`sector_id = ANY($${idx}::int[])`);
      params.push(registerSectorIds);
      idx++;
    }

    let tsParamIdx = 0;
    if (tsQuery) {
      tsParamIdx = idx;
      conditions.push(`to_tsvector('english', name || ' ' || COALESCE(purpose, '')) @@ to_tsquery('english', $${idx})`);
      params.push(tsQuery);
      idx++;
    }

    const whereClause = conditions.join(' OR ');
    const orderClause = tsParamIdx
      ? `ts_rank(to_tsvector('english', name || ' ' || COALESCE(purpose, '')), to_tsquery('english', $${tsParamIdx})) DESC`
      : 'name ASC';

    params.push(limit);

    const query = `
      SELECT name, website_url AS url, grant_url AS "grantUrl", purpose, grant_summary AS "grantSummary"
      FROM charities
      WHERE website_url IS NOT NULL AND (${whereClause})
      ORDER BY ${orderClause}
      LIMIT $${idx}
    `;

    const { rows } = await db.query(query, params);
    console.log(`[GrantSearch] Charities DB: ${rows.length} matching funders found`);
    return rows as { name: string; url: string; grantUrl: string | null; purpose: string; grantSummary: string | null }[];
  } catch (err) {
    console.warn('[GrantSearch] DB query failed — skipping charity register lookup:', err);
    return [];
  }
}

// ─── Search Result Cache ──────────────────────────────────────────────────────

let cacheTableReady = false;

async function ensureCacheTable(): Promise<void> {
  if (cacheTableReady) return;
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) return;
  try {
    const db = getPool();
    await db.query(`
      CREATE TABLE IF NOT EXISTS search_cache (
        id SERIAL PRIMARY KEY,
        market TEXT NOT NULL,
        inputs_json JSONB NOT NULL,
        result_json JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    cacheTableReady = true;
  } catch (err) {
    console.warn('[SearchCache] Failed to create cache table:', err);
  }
}

export async function saveSearchResult(market: string, inputs: object, result: SearchResult): Promise<void> {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) return;
  try {
    await ensureCacheTable();
    const db = getPool();
    // Replace any existing cache for this market
    await db.query('DELETE FROM search_cache WHERE market = $1', [market]);
    await db.query(
      'INSERT INTO search_cache (market, inputs_json, result_json) VALUES ($1, $2, $3)',
      [market, JSON.stringify(inputs), JSON.stringify(result)],
    );
    console.log(`[SearchCache] Saved ${result.grants.length} grants for market "${market}"`);
  } catch (err) {
    console.warn('[SearchCache] Failed to save cached result:', err);
  }
}

export async function loadSearchResult(market: string): Promise<SearchResult | null> {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) return null;
  try {
    await ensureCacheTable();
    const db = getPool();
    const { rows } = await db.query(
      'SELECT result_json, created_at FROM search_cache WHERE market = $1 ORDER BY created_at DESC LIMIT 1',
      [market],
    );
    if (rows.length === 0) return null;
    const age = Date.now() - new Date(rows[0].created_at).getTime();
    const days = Math.round(age / 86_400_000);
    console.log(`[SearchCache] Loaded cached result for "${market}" (${days}d old, ${(rows[0].result_json as SearchResult).grants?.length ?? '?'} grants)`);
    return rows[0].result_json as SearchResult;
  } catch (err) {
    console.warn('[SearchCache] Failed to load cached result:', err);
    return null;
  }
}
