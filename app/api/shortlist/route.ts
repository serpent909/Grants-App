import { NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';
import { authedRoute, parseBody, optionalIdParam, parseIdList, ApiError } from '@/lib/api';
import { createShortlistSchema } from '@/lib/schemas';

export const GET = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const db = getPool();
  const { searchParams } = req.nextUrl;

  // Lightweight: return all shortlisted grant IDs (no JSON blobs)
  if (searchParams.get('idsOnly') === 'true') {
    const { rows } = await db.query(
      `SELECT grant_id FROM shortlisted_grants WHERE org_id = $1`,
      [orgId],
    );
    return NextResponse.json(rows.map(r => r.grant_id));
  }

  // Batch lookup: return just matching IDs
  if (searchParams.has('grantIds')) {
    const ids = parseIdList(searchParams.get('grantIds'));
    if (ids.length === 0) return NextResponse.json([]);
    const { rows } = await db.query(
      `SELECT grant_id FROM shortlisted_grants WHERE org_id = $1 AND grant_id = ANY($2::text[])`,
      [orgId, ids],
    );
    return NextResponse.json(rows.map(r => r.grant_id));
  }

  const { rows } = await db.query(
    `SELECT grant_id AS "grantId", grant_json AS grant, search_title AS "searchTitle",
            shortlisted_at AS "shortlistedAt"
     FROM shortlisted_grants WHERE org_id = $1 ORDER BY shortlisted_at DESC`,
    [orgId],
  );

  // Grouped by search title
  if (searchParams.get('grouped') === 'true') {
    const result: Record<string, typeof rows> = {};
    for (const row of rows) {
      const key = row.searchTitle || 'Untitled search';
      (result[key] ??= []).push(row);
    }
    return NextResponse.json(result);
  }

  return NextResponse.json(rows);
});

export const POST = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const { grant, searchTitle } = await parseBody(req, createShortlistSchema);
  await getPool().query(
    `INSERT INTO shortlisted_grants (org_id, grant_id, grant_json, search_title, shortlisted_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (org_id, grant_id) DO UPDATE SET
       grant_json = EXCLUDED.grant_json, search_title = EXCLUDED.search_title`,
    [orgId, grant.id, JSON.stringify(grant), searchTitle],
  );
  return NextResponse.json({ ok: true });
});

export const DELETE = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const { searchParams } = req.nextUrl;
  const db = getPool();

  // Bulk delete by search title
  const searchTitle = searchParams.get('searchTitle');
  if (searchTitle) {
    if (searchTitle.length > 500) throw new ApiError(400, 'Invalid searchTitle');
    await db.query(
      'DELETE FROM shortlisted_grants WHERE org_id = $1 AND search_title = $2',
      [orgId, searchTitle],
    );
    return NextResponse.json({ ok: true });
  }

  // Single delete by grant ID
  const grantId = optionalIdParam(searchParams, 'grantId');
  if (!grantId) throw new ApiError(400, 'grantId or searchTitle required');
  await db.query(
    'DELETE FROM shortlisted_grants WHERE org_id = $1 AND grant_id = $2',
    [orgId, grantId],
  );
  return NextResponse.json({ ok: true });
});
