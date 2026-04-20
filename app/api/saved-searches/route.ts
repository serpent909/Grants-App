import { NextRequest, NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';
import { getOrgId } from '@/lib/auth-helpers';
import { createSavedSearchSchema, updateSavedSearchSchema, parseOrError } from '@/lib/schemas';

export async function GET() {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const db = getPool();
  const { rows } = await db.query(
    `SELECT id, name, saved_at AS "savedAt", grant_count AS "grantCount",
            org_summary AS "orgSummary", market, result_json AS result
     FROM saved_searches WHERE org_id = $1 ORDER BY saved_at DESC`,
    [orgId]
  );

  // Refresh grant URLs from the live grants table so saved-search snapshots
  // never show stale links after a pipeline run renames or recreates a grant.
  // Scores, descriptions and reasons stay frozen — only id and url are updated.
  type SnapGrant = { id: string; url: string; name?: string; funder?: string };
  const allIds = new Set<string>();
  for (const r of rows) {
    for (const g of (r.result?.grants ?? []) as SnapGrant[]) {
      if (g?.id) allIds.add(g.id);
    }
  }

  if (allIds.size > 0) {
    // Primary lookup: by id
    const { rows: liveRows } = await db.query<{ id: string; url: string }>(
      `SELECT id, url FROM grants WHERE id = ANY($1)`,
      [Array.from(allIds)],
    );
    const liveUrl = new Map(liveRows.map(r => [r.id, r.url]));

    // Fallback lookup: by (funder, name) for orphaned snapshot ids (e.g.
    // grants recreated by a pipeline rebuild with a new id).
    const orphanPairs: Array<{ funder: string; name: string }> = [];
    const seenPair = new Set<string>();
    for (const r of rows) {
      for (const g of (r.result?.grants ?? []) as SnapGrant[]) {
        if (!g?.id || liveUrl.has(g.id)) continue;
        if (!g.funder || !g.name) continue;
        const key = `${g.funder.toLowerCase()}||${g.name.toLowerCase()}`;
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
        byFunderName.set(`${nr.funder_name.toLowerCase()}||${nr.name.toLowerCase()}`, { id: nr.id, url: nr.url });
      }
    }

    for (const r of rows) {
      if (!Array.isArray(r.result?.grants)) continue;
      r.result.grants = (r.result.grants as SnapGrant[]).map(g => {
        // Use `has` not truthiness so grants whose live url has been cleared
        // to '' (pending re-discovery) still get patched and stop showing
        // stale URLs in the UI.
        if (liveUrl.has(g.id)) {
          const liveById = liveUrl.get(g.id)!;
          return liveById !== g.url ? { ...g, url: liveById } : g;
        }
        if (g.funder && g.name) {
          const liveByName = byFunderName.get(`${g.funder.toLowerCase()}||${g.name.toLowerCase()}`);
          if (liveByName && (liveByName.url !== g.url || liveByName.id !== g.id)) {
            return { ...g, id: liveByName.id, url: liveByName.url };
          }
        }
        return g;
      });
    }
  }

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const parsed = parseOrError(createSavedSearchSchema, await req.json());
  if ('error' in parsed) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { id, name, savedAt, grantCount, orgSummary, market, result } = parsed.data;
  const db = getPool();
  await db.query(
    `INSERT INTO saved_searches (id, org_id, name, saved_at, grant_count, org_summary, market, result_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, saved_at = EXCLUDED.saved_at,
       grant_count = EXCLUDED.grant_count, org_summary = EXCLUDED.org_summary,
       result_json = EXCLUDED.result_json`,
    [id, orgId, name, savedAt, grantCount, orgSummary, market, JSON.stringify(result)]
  );
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const parsed = parseOrError(updateSavedSearchSchema, await req.json());
  if ('error' in parsed) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { id, result, grantCount, orgSummary } = parsed.data;
  const db = getPool();
  await db.query(
    `UPDATE saved_searches
     SET saved_at = NOW(), grant_count = $2, org_summary = $3, result_json = $4
     WHERE id = $1 AND org_id = $5`,
    [id, grantCount, orgSummary, JSON.stringify(result), orgId]
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const db = getPool();
  await db.query('DELETE FROM saved_searches WHERE id = $1 AND org_id = $2', [id, orgId]);
  return NextResponse.json({ ok: true });
}
