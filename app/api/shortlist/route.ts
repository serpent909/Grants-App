import { NextRequest, NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';
import { getOrgId } from '@/lib/auth-helpers';
import { createShortlistSchema, parseOrError } from '@/lib/schemas';

export async function GET(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const db = getPool();
  const { searchParams } = new URL(req.url);

  // Lightweight: return all shortlisted grant IDs (no JSON blobs)
  if (searchParams.get('idsOnly') === 'true') {
    const { rows } = await db.query(
      `SELECT grant_id FROM shortlisted_grants WHERE org_id = $1`,
      [orgId]
    );
    return NextResponse.json(rows.map(r => r.grant_id));
  }

  // Batch lookup: return just matching IDs
  const grantIds = searchParams.get('grantIds');
  if (grantIds) {
    const ids = grantIds.split(',').filter(Boolean);
    if (ids.length === 0) return NextResponse.json([]);
    const { rows } = await db.query(
      `SELECT grant_id FROM shortlisted_grants WHERE org_id = $1 AND grant_id = ANY($2::text[])`,
      [orgId, ids]
    );
    return NextResponse.json(rows.map(r => r.grant_id));
  }

  // Grouped by search title
  const grouped = searchParams.get('grouped');
  if (grouped === 'true') {
    const { rows } = await db.query(
      `SELECT grant_id AS "grantId", grant_json AS grant, search_title AS "searchTitle",
              shortlisted_at AS "shortlistedAt"
       FROM shortlisted_grants WHERE org_id = $1 ORDER BY shortlisted_at DESC`,
      [orgId]
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
     FROM shortlisted_grants WHERE org_id = $1 ORDER BY shortlisted_at DESC`,
    [orgId]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const parsed = parseOrError(createShortlistSchema, await req.json());
  if ('error' in parsed) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { grant, searchTitle } = parsed.data;
  const db = getPool();
  await db.query(
    `INSERT INTO shortlisted_grants (org_id, grant_id, grant_json, search_title, shortlisted_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (org_id, grant_id) DO UPDATE SET
       grant_json = EXCLUDED.grant_json, search_title = EXCLUDED.search_title`,
    [orgId, grant.id, JSON.stringify(grant), searchTitle || '']
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const { searchParams } = new URL(req.url);
  const db = getPool();

  // Bulk delete by search title
  const searchTitle = searchParams.get('searchTitle');
  if (searchTitle) {
    await db.query('DELETE FROM shortlisted_grants WHERE org_id = $1 AND search_title = $2', [orgId, searchTitle]);
    return NextResponse.json({ ok: true });
  }

  // Single delete by grant ID
  const grantId = searchParams.get('grantId');
  if (!grantId) return NextResponse.json({ error: 'grantId or searchTitle required' }, { status: 400 });
  await db.query('DELETE FROM shortlisted_grants WHERE org_id = $1 AND grant_id = $2', [orgId, grantId]);
  return NextResponse.json({ ok: true });
}
