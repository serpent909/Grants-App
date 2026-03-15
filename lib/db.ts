import { Pool } from '@neondatabase/serverless';

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
  limit = 100,
): Promise<{ name: string; url: string; purpose: string }[]> {
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
      SELECT name, website_url AS url, purpose
      FROM charities
      WHERE website_url IS NOT NULL AND (${whereClause})
      ORDER BY ${orderClause}
      LIMIT $${idx}
    `;

    const { rows } = await db.query(query, params);
    console.log(`[GrantSearch] Charities DB: ${rows.length} matching funders found`);
    return rows as { name: string; url: string; purpose: string }[];
  } catch (err) {
    console.warn('[GrantSearch] DB query failed — skipping charity register lookup:', err);
    return [];
  }
}
