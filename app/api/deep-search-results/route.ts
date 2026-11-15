import { NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';
import { authedRoute, requireIdParam, optionalIdParam, parseIdList } from '@/lib/api';

// Results are written by POST /api/deep-search itself (server-side), so there is
// deliberately no POST here: clients cannot store arbitrary JSON as a "result".

export const GET = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const db = getPool();
  const { searchParams } = req.nextUrl;

  // Lightweight: return all deep-searched grant IDs (no result JSON)
  if (searchParams.get('idsOnly') === 'true') {
    const { rows } = await db.query(
      `SELECT grant_id, searched_at FROM deep_searches WHERE org_id = $1`,
      [orgId],
    );
    return NextResponse.json(rows.map(r => ({ id: r.grant_id, searchedAt: r.searched_at })));
  }

  // Batch lookup: return matching IDs with timestamps
  if (searchParams.has('grantIds')) {
    const ids = parseIdList(searchParams.get('grantIds'));
    if (ids.length === 0) return NextResponse.json([]);
    const { rows } = await db.query(
      `SELECT grant_id, searched_at FROM deep_searches WHERE org_id = $1 AND grant_id = ANY($2::text[])`,
      [orgId, ids],
    );
    return NextResponse.json(rows.map(r => ({ id: r.grant_id, searchedAt: r.searched_at })));
  }

  // Single grant lookup
  const grantId = optionalIdParam(searchParams, 'grantId');
  if (grantId) {
    const { rows } = await db.query(
      `SELECT result_json FROM deep_searches WHERE org_id = $1 AND grant_id = $2`,
      [orgId, grantId],
    );
    return NextResponse.json(rows[0]?.result_json ?? null);
  }

  // All deep searches (for batch loading on shortlisted/applications pages)
  const { rows } = await db.query(
    `SELECT grant_id AS "grantId", result_json AS result FROM deep_searches WHERE org_id = $1`,
    [orgId],
  );
  return NextResponse.json(rows);
});

export const DELETE = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const grantId = requireIdParam(req.nextUrl.searchParams, 'grantId');
  await getPool().query(
    'DELETE FROM deep_searches WHERE org_id = $1 AND grant_id = $2',
    [orgId, grantId],
  );
  return NextResponse.json({ ok: true });
});
