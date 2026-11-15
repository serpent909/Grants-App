import { NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';
import { authedRoute, parseBody, requireIdParam, optionalIdParam, parseIdList, ApiError } from '@/lib/api';
import { createApplicationSchema, updateApplicationSchema } from '@/lib/schemas';

// NUMERIC columns come back from pg as strings — cast so the client gets numbers.
const APPLICATION_COLUMNS = `
  grant_id AS "grantId", id, grant_json AS grant, search_title AS "searchTitle",
  status, status_history AS "statusHistory", notes,
  started_at AS "startedAt", submitted_at AS "submittedAt",
  decided_at AS "decidedAt",
  amount_requested::float8 AS "amountRequested",
  amount_awarded::float8 AS "amountAwarded"`;

export const GET = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const db = getPool();
  const { searchParams } = req.nextUrl;

  // Single application lookup
  const grantId = optionalIdParam(searchParams, 'grantId');
  if (grantId) {
    const { rows } = await db.query(
      `SELECT ${APPLICATION_COLUMNS} FROM grant_applications WHERE org_id = $1 AND grant_id = $2`,
      [orgId, grantId],
    );
    return NextResponse.json(rows[0] ?? null);
  }

  // Lightweight: every grant ID that has an application
  if (searchParams.get('idsOnly') === 'true') {
    const { rows } = await db.query(
      `SELECT grant_id FROM grant_applications WHERE org_id = $1`,
      [orgId],
    );
    return NextResponse.json(rows.map(r => r.grant_id));
  }

  // Batch check: return just the IDs (from the given list) that have applications
  if (searchParams.has('grantIds')) {
    const ids = parseIdList(searchParams.get('grantIds'));
    if (ids.length === 0) return NextResponse.json([]);
    const { rows } = await db.query(
      `SELECT grant_id FROM grant_applications WHERE org_id = $1 AND grant_id = ANY($2::text[])`,
      [orgId, ids],
    );
    return NextResponse.json(rows.map(r => r.grant_id));
  }

  // All applications, sorted by latest activity
  const { rows } = await db.query(
    `SELECT ${APPLICATION_COLUMNS} FROM grant_applications WHERE org_id = $1 ORDER BY updated_at DESC`,
    [orgId],
  );
  return NextResponse.json(rows);
});

export const POST = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const { grant, searchTitle } = await parseBody(req, createApplicationSchema);

  const now = new Date().toISOString();
  const history = [{ status: 'preparing', note: 'Application started', updatedAt: now }];

  // Starting an application twice must never reset an existing one.
  const db = getPool();
  await db.query(
    `INSERT INTO grant_applications
       (org_id, grant_id, id, grant_json, search_title, status, status_history, notes, started_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'preparing', $6, '', $7, NOW())
     ON CONFLICT (org_id, grant_id) DO NOTHING`,
    [orgId, grant.id, `app_${crypto.randomUUID()}`, JSON.stringify(grant), searchTitle, JSON.stringify(history), now],
  );

  const { rows } = await db.query(
    `SELECT ${APPLICATION_COLUMNS} FROM grant_applications WHERE org_id = $1 AND grant_id = $2`,
    [orgId, grant.id],
  );
  return NextResponse.json(rows[0]);
});

export const PUT = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const { grantId, status, note, notes, amountRequested, amountAwarded } =
    await parseBody(req, updateApplicationSchema);

  const sets: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [orgId, grantId];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (status !== undefined) {
    // Append to the history atomically in SQL — no read-modify-write from the client.
    const entry = [{ status, note, updatedAt: new Date().toISOString() }];
    const statusParam = add(status);
    sets.push(`status = ${statusParam}`);
    sets.push(`status_history = status_history || ${add(JSON.stringify(entry))}::jsonb`);
    if (status === 'submitted') sets.push('submitted_at = NOW()');
    if (status === 'approved' || status === 'declined') sets.push('decided_at = NOW()');
  }
  if (notes !== undefined) sets.push(`notes = ${add(notes)}`);
  if (amountRequested !== undefined) sets.push(`amount_requested = ${add(amountRequested)}`);
  if (amountAwarded !== undefined) sets.push(`amount_awarded = ${add(amountAwarded)}`);

  const { rows } = await getPool().query(
    `UPDATE grant_applications SET ${sets.join(', ')}
     WHERE org_id = $1 AND grant_id = $2
     RETURNING ${APPLICATION_COLUMNS}`,
    params,
  );
  if (rows.length === 0) throw new ApiError(404, 'Application not found');
  return NextResponse.json(rows[0]);
});

export const DELETE = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const grantId = requireIdParam(req.nextUrl.searchParams, 'grantId');
  await getPool().query(
    'DELETE FROM grant_applications WHERE org_id = $1 AND grant_id = $2',
    [orgId, grantId],
  );
  return NextResponse.json({ ok: true });
});
