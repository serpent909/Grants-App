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

/** "Name", "Name (2)", "Name (3)"… — the first that is not already taken. */
function makeUniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const base = name.replace(/ \(\d+\)$/, '');
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} (${n})`.slice(0, 500);
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (${crypto.randomUUID().slice(0, 6)})`;
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
  const db = getPool();

  // Shortlisted grants and applications are grouped by search name, so two
  // searches must not share one: "Ops funding" → "Ops funding (2)".
  const { rows: taken } = await db.query<{ name: string }>(
    'SELECT name FROM saved_searches WHERE org_id = $1',
    [orgId],
  );
  const uniqueName = makeUniqueName(name.trim() || 'Untitled search', new Set(taken.map(r => r.name)));

  const { rows } = await db.query(
    `INSERT INTO saved_searches (id, org_id, name, saved_at, grant_count, org_summary, market, result_json)
     VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)
     RETURNING ${SAVED_COLUMNS}`,
    [id, orgId, uniqueName, result.grants.length, result.orgSummary, result.market, JSON.stringify(result)],
  );
  return NextResponse.json(rows[0]);
});

export const PUT = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  // Re-running a search replaces its results in place. The name is kept: it is
  // what links the search to the grants shortlisted from it.
  const { id, result } = await parseBody(req, updateSavedSearchSchema);
  const { rows } = await getPool().query(
    `UPDATE saved_searches
     SET saved_at = NOW(), grant_count = $2, org_summary = $3, result_json = $4
     WHERE id = $1 AND org_id = $5
     RETURNING ${SAVED_COLUMNS}`,
    [id, result.grants.length, result.orgSummary, JSON.stringify(result), orgId],
  );
  if (rows.length === 0) throw new ApiError(404, 'Saved search not found');
  return NextResponse.json(rows[0]);
});

export const DELETE = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const id = requireIdParam(req.nextUrl.searchParams, 'id');
  await getPool().query('DELETE FROM saved_searches WHERE id = $1 AND org_id = $2', [id, orgId]);
  return NextResponse.json({ ok: true });
});
