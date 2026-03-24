import { NextRequest, NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';

export async function GET(req: NextRequest) {
  await ensureStorageTables();
  const db = getPool();
  const { searchParams } = new URL(req.url);

  // Batch lookup: return just matching IDs
  const grantIds = searchParams.get('grantIds');
  if (grantIds) {
    const ids = grantIds.split(',').filter(Boolean);
    if (ids.length === 0) return NextResponse.json([]);
    const { rows } = await db.query(
      `SELECT grant_id FROM shortlisted_grants WHERE grant_id = ANY($1::text[])`,
      [ids]
    );
    return NextResponse.json(rows.map(r => r.grant_id));
  }

  // Grouped by search title
  const grouped = searchParams.get('grouped');
  if (grouped === 'true') {
    const { rows } = await db.query(
      `SELECT grant_id AS "grantId", grant_json AS grant, search_title AS "searchTitle",
              shortlisted_at AS "shortlistedAt"
       FROM shortlisted_grants ORDER BY shortlisted_at DESC`
    );
    const result: Record<string, typeof rows> = {};
    for (const row of rows) {
      const key = row.searchTitle || 'Untitled search';
      if (!result[key]) result[key] = [];
      result[key].push(row);
    }
    return NextResponse.json(result);
  }

  // Default: return all
  const { rows } = await db.query(
    `SELECT grant_id AS "grantId", grant_json AS grant, search_title AS "searchTitle",
            shortlisted_at AS "shortlistedAt"
     FROM shortlisted_grants ORDER BY shortlisted_at DESC`
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  await ensureStorageTables();
  const { grant, searchTitle } = await req.json();
  const db = getPool();
  await db.query(
    `INSERT INTO shortlisted_grants (grant_id, grant_json, search_title, shortlisted_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (grant_id) DO UPDATE SET
       grant_json = EXCLUDED.grant_json, search_title = EXCLUDED.search_title`,
    [grant.id, JSON.stringify(grant), searchTitle || '']
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await ensureStorageTables();
  const { searchParams } = new URL(req.url);
  const db = getPool();

  // Bulk delete by search title
  const searchTitle = searchParams.get('searchTitle');
  if (searchTitle) {
    await db.query('DELETE FROM shortlisted_grants WHERE search_title = $1', [searchTitle]);
    return NextResponse.json({ ok: true });
  }

  // Single delete by grant ID
  const grantId = searchParams.get('grantId');
  if (!grantId) return NextResponse.json({ error: 'grantId or searchTitle required' }, { status: 400 });
  await db.query('DELETE FROM shortlisted_grants WHERE grant_id = $1', [grantId]);
  return NextResponse.json({ ok: true });
}
