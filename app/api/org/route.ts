import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authedRoute, parseBody, ApiError } from '@/lib/api';
import { updateOrgSchema } from '@/lib/schemas';

export const GET = authedRoute(async (_req, { orgId }) => {
  const { rows } = await getPool().query(
    'SELECT id, name, slug, created_at AS "createdAt" FROM organisations WHERE id = $1',
    [orgId],
  );
  if (rows.length === 0) throw new ApiError(404, 'Organisation not found');
  return NextResponse.json(rows[0]);
});

export const PUT = authedRoute(async (req, { orgId }) => {
  const { name } = await parseBody(req, updateOrgSchema);
  await getPool().query(
    'UPDATE organisations SET name = $1, updated_at = NOW() WHERE id = $2',
    [name, orgId],
  );
  return NextResponse.json({ ok: true, name });
});
