import { NextRequest, NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';

export async function GET() {
  await ensureStorageTables();
  const db = getPool();
  const { rows } = await db.query(
    `SELECT id, name, saved_at AS "savedAt", grant_count AS "grantCount",
            org_summary AS "orgSummary", market, result_json AS result
     FROM saved_searches ORDER BY saved_at DESC`
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  await ensureStorageTables();
  const body = await req.json();
  const { id, name, savedAt, grantCount, orgSummary, market, result } = body;
  const db = getPool();
  await db.query(
    `INSERT INTO saved_searches (id, name, saved_at, grant_count, org_summary, market, result_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, saved_at = EXCLUDED.saved_at,
       grant_count = EXCLUDED.grant_count, org_summary = EXCLUDED.org_summary,
       result_json = EXCLUDED.result_json`,
    [id, name, savedAt, grantCount, orgSummary, market, JSON.stringify(result)]
  );
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  await ensureStorageTables();
  const body = await req.json();
  const { id, result, grantCount, orgSummary } = body;
  const db = getPool();
  await db.query(
    `UPDATE saved_searches
     SET saved_at = NOW(), grant_count = $2, org_summary = $3, result_json = $4
     WHERE id = $1`,
    [id, grantCount, orgSummary, JSON.stringify(result)]
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await ensureStorageTables();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const db = getPool();
  await db.query('DELETE FROM saved_searches WHERE id = $1', [id]);
  return NextResponse.json({ ok: true });
}
