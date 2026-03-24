import { NextRequest, NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';
import { getOrgId } from '@/lib/auth-helpers';

export async function GET(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const db = getPool();
  const { searchParams } = new URL(req.url);

  // Single application lookup
  const grantId = searchParams.get('grantId');
  if (grantId) {
    const { rows } = await db.query(
      `SELECT grant_id AS "grantId", id, grant_json AS grant, search_title AS "searchTitle",
              status, status_history AS "statusHistory", notes,
              started_at AS "startedAt", submitted_at AS "submittedAt",
              decided_at AS "decidedAt", amount_requested AS "amountRequested",
              amount_awarded AS "amountAwarded"
       FROM grant_applications WHERE org_id = $1 AND grant_id = $2`,
      [orgId, grantId]
    );
    if (rows.length === 0) return NextResponse.json(null);
    return NextResponse.json(rows[0]);
  }

  // Batch check: return just IDs that have applications
  const grantIds = searchParams.get('grantIds');
  if (grantIds) {
    const ids = grantIds.split(',').filter(Boolean);
    if (ids.length === 0) return NextResponse.json([]);
    const { rows } = await db.query(
      `SELECT grant_id FROM grant_applications WHERE org_id = $1 AND grant_id = ANY($2::text[])`,
      [orgId, ids]
    );
    return NextResponse.json(rows.map(r => r.grant_id));
  }

  // All applications, sorted by latest activity
  const { rows } = await db.query(
    `SELECT grant_id AS "grantId", id, grant_json AS grant, search_title AS "searchTitle",
            status, status_history AS "statusHistory", notes,
            started_at AS "startedAt", submitted_at AS "submittedAt",
            decided_at AS "decidedAt", amount_requested AS "amountRequested",
            amount_awarded AS "amountAwarded"
     FROM grant_applications WHERE org_id = $1 ORDER BY updated_at DESC`,
    [orgId]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const body = await req.json();
  const { id, grantId, grant, searchTitle, status, statusHistory, notes, startedAt } = body;
  const db = getPool();
  await db.query(
    `INSERT INTO grant_applications
       (org_id, grant_id, id, grant_json, search_title, status, status_history, notes, started_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (org_id, grant_id) DO UPDATE SET
       grant_json = EXCLUDED.grant_json, status = EXCLUDED.status,
       status_history = EXCLUDED.status_history, notes = EXCLUDED.notes,
       updated_at = NOW()`,
    [orgId, grantId, id, JSON.stringify(grant), searchTitle || '', status, JSON.stringify(statusHistory), notes || '', startedAt]
  );
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const body = await req.json();
  const { grantId, ...updates } = body;
  if (!grantId) return NextResponse.json({ error: 'grantId required' }, { status: 400 });

  const db = getPool();
  const sets: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [orgId, grantId];
  let idx = 3;

  if (updates.status !== undefined) {
    sets.push(`status = $${idx++}`);
    params.push(updates.status);
  }
  if (updates.statusHistory !== undefined) {
    sets.push(`status_history = $${idx++}`);
    params.push(JSON.stringify(updates.statusHistory));
  }
  if (updates.notes !== undefined) {
    sets.push(`notes = $${idx++}`);
    params.push(updates.notes);
  }
  if (updates.submittedAt !== undefined) {
    sets.push(`submitted_at = $${idx++}`);
    params.push(updates.submittedAt);
  }
  if (updates.decidedAt !== undefined) {
    sets.push(`decided_at = $${idx++}`);
    params.push(updates.decidedAt);
  }
  if (updates.amountRequested !== undefined) {
    sets.push(`amount_requested = $${idx++}`);
    params.push(updates.amountRequested);
  }
  if (updates.amountAwarded !== undefined) {
    sets.push(`amount_awarded = $${idx++}`);
    params.push(updates.amountAwarded);
  }

  await db.query(
    `UPDATE grant_applications SET ${sets.join(', ')} WHERE org_id = $1 AND grant_id = $2`,
    params
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
  await db.query('DELETE FROM grant_applications WHERE org_id = $1 AND grant_id = $2', [orgId, grantId]);
  return NextResponse.json({ ok: true });
}
