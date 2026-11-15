import { NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';
import { authedRoute, parseBody, requireIdParam, optionalIdParam, ApiError } from '@/lib/api';
import { createSavedSearchSchema, updateSavedSearchSchema } from '@/lib/schemas';

type SnapGrant = { id: string; url: string; name?: string; funder?: string };
type SavedRow = { result?: { grants?: SnapGrant[] } } & Record<string, unknown>;

const SAVED_COLUMNS = `
  id, name, saved_at AS "savedAt", grant_count AS "grantCount",
  org_summary AS "orgSummary", market, result_json AS result`;

/**
 * Refresh grant URLs from the live grants table so saved-search snapshots
 * never show stale links after a pipeline run renames or recreates a grant.
 * Scores, descriptions and reasons stay frozen — only id and url are updated.
 */
async function refreshGrantUrls(rows: SavedRow[]): Promise<void> {
  const allIds = new Set<string>();
  for (const r of rows) {
    for (const g of r.result?.grants ?? []) {
      if (g?.id) allIds.add(g.id);
    }
  }
  if (allIds.size === 0) return;

  const db = getPool();

  // Primary lookup: by id
  const { rows: liveRows } = await db.query<{ id: string; url: string }>(
    `SELECT id, url FROM grants WHERE id = ANY($1)`,
    [Array.from(allIds)],
  );
  const liveUrl = new Map(liveRows.map(r => [r.id, r.url]));

  // Fallback lookup: by (funder, name) for orphaned snapshot ids (e.g.
  // grants recreated by a pipeline rebuild with a new id).
  const pairKey = (funder: string, name: string) => `${funder.toLowerCase()}||${name.toLowerCase()}`;
  const orphanPairs: Array<{ funder: string; name: string }> = [];
  const seenPair = new Set<string>();
  for (const r of rows) {
    for (const g of r.result?.grants ?? []) {
      if (!g?.id || liveUrl.has(g.id) || !g.funder || !g.name) continue;
      const key = pairKey(g.funder, g.name);
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      orphanPairs.push({ funder: g.funder, name: g.name });
    }
  }

  const byFunderName = new Map<string, { id: string; url: string }>();
  if (orphanPairs.length > 0) {
    const { rows: nameRows } = await db.query<{
      id: string; url: string; funder_name: string; name: string;
    }>(
      `SELECT id, url, funder_name, name FROM grants
       WHERE (lower(funder_name), lower(name)) IN (
         SELECT lower(unnest($1::text[])), lower(unnest($2::text[]))
       )`,
      [orphanPairs.map(p => p.funder), orphanPairs.map(p => p.name)],
    );
    for (const nr of nameRows) {
      byFunderName.set(pairKey(nr.funder_name, nr.name), { id: nr.id, url: nr.url });
    }
  }

  for (const r of rows) {
    if (!r.result || !Array.isArray(r.result.grants)) continue;
    r.result.grants = r.result.grants.map(g => {
      // Use `has` not truthiness so grants whose live url has been cleared
      // to '' (pending re-discovery) still get patched and stop showing
      // stale URLs in the UI.
      if (liveUrl.has(g.id)) {
        const liveById = liveUrl.get(g.id)!;
        return liveById !== g.url ? { ...g, url: liveById } : g;
      }
      if (g.funder && g.name) {
        const liveByName = byFunderName.get(pairKey(g.funder, g.name));
        if (liveByName && (liveByName.url !== g.url || liveByName.id !== g.id)) {
          return { ...g, id: liveByName.id, url: liveByName.url };
        }
      }
      return g;
    });
  }
}

export const GET = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const db = getPool();

  // Single saved search (used by the results page)
  const id = optionalIdParam(req.nextUrl.searchParams, 'id');
  if (id) {
    const { rows } = await db.query<SavedRow>(
      `SELECT ${SAVED_COLUMNS} FROM saved_searches WHERE id = $1 AND org_id = $2`,
      [id, orgId],
    );
    if (rows.length === 0) throw new ApiError(404, 'Saved search not found');
    await refreshGrantUrls(rows);
    return NextResponse.json(rows[0]);
  }

  const { rows } = await db.query<SavedRow>(
    `SELECT ${SAVED_COLUMNS} FROM saved_searches WHERE org_id = $1 ORDER BY saved_at DESC`,
    [orgId],
  );
  await refreshGrantUrls(rows);
  return NextResponse.json(rows);
});

export const POST = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const { name, result } = await parseBody(req, createSavedSearchSchema);

  // The ID is always generated here. (It used to come from the client with an
  // upsert on id alone, which let one org overwrite another org's saved search.)
  const id = `saved_${crypto.randomUUID()}`;
  const { rows } = await getPool().query(
    `INSERT INTO saved_searches (id, org_id, name, saved_at, grant_count, org_summary, market, result_json)
     VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)
     RETURNING ${SAVED_COLUMNS}`,
    [id, orgId, name, result.grants.length, result.orgSummary, result.market, JSON.stringify(result)],
  );
  return NextResponse.json(rows[0]);
});

export const PUT = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const { id, result } = await parseBody(req, updateSavedSearchSchema);
  const { rowCount } = await getPool().query(
    `UPDATE saved_searches
     SET saved_at = NOW(), grant_count = $2, org_summary = $3, result_json = $4
     WHERE id = $1 AND org_id = $5`,
    [id, result.grants.length, result.orgSummary, JSON.stringify(result), orgId],
  );
  if (!rowCount) throw new ApiError(404, 'Saved search not found');
  return NextResponse.json({ ok: true });
});

export const DELETE = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const id = requireIdParam(req.nextUrl.searchParams, 'id');
  await getPool().query('DELETE FROM saved_searches WHERE id = $1 AND org_id = $2', [id, orgId]);
  return NextResponse.json({ ok: true });
});
