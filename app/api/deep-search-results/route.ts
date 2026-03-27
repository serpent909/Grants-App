import { NextRequest, NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';
import { getOrgId } from '@/lib/auth-helpers';

export async function GET(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const db = getPool();
  const { searchParams } = new URL(req.url);

  // Lightweight: return all deep-searched grant IDs (no result JSON)
  if (searchParams.get('idsOnly') === 'true') {
    const { rows } = await db.query(
      `SELECT grant_id, searched_at FROM deep_searches WHERE org_id = $1`,
      [orgId]
    );
    return NextResponse.json(rows.map(r => ({ id: r.grant_id, searchedAt: r.searched_at })));
  }

  // Batch lookup: return matching IDs with timestamps
  const grantIds = searchParams.get('grantIds');
  if (grantIds) {
    const ids = grantIds.split(',').filter(Boolean);
    if (ids.length === 0) return NextResponse.json([]);
    const { rows } = await db.query(
      `SELECT grant_id, searched_at FROM deep_searches WHERE org_id = $1 AND grant_id = ANY($2::text[])`,
      [orgId, ids]
    );
    return NextResponse.json(rows.map(r => ({ id: r.grant_id, searchedAt: r.searched_at })));
  }

  // Single grant lookup
  const grantId = searchParams.get('grantId');
  if (grantId) {
    const { rows } = await db.query(
      `SELECT result_json FROM deep_searches WHERE org_id = $1 AND grant_id = $2`,
      [orgId, grantId]
    );
    if (rows.length === 0) return NextResponse.json(null);
    return NextResponse.json(rows[0].result_json);
  }

  // All deep searches (for batch loading on shortlisted/applications pages)
  const { rows } = await db.query(
    `SELECT grant_id AS "grantId", result_json AS result FROM deep_searches WHERE org_id = $1`,
    [orgId]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const result = await req.json();
  const db = getPool();
  await db.query(
    `INSERT INTO deep_searches (org_id, grant_id, result_json, searched_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (org_id, grant_id) DO UPDATE SET
       result_json = EXCLUDED.result_json, searched_at = EXCLUDED.searched_at`,
    [orgId, result.grantId, JSON.stringify(result), result.searchedAt || new Date().toISOString()]
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const { searchParams } = new URL(req.url);
  const grantId = searchParams.get('grantId');
  if (!grantId) return NextResponse.json({ error: 'grantId required' }, { status: 400 });
  const db = getPool();
  await db.query('DELETE FROM deep_searches WHERE org_id = $1 AND grant_id = $2', [orgId, grantId]);
  return NextResponse.json({ ok: true });
}
