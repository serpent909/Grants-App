import { NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';
import { authedRoute, parseBody, requireIdParam, ApiError } from '@/lib/api';
import { initChecklistSchema, toggleChecklistSchema, deepSearchModelOutputSchema } from '@/lib/schemas';

export const GET = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const db = getPool();
  const grantId = requireIdParam(req.nextUrl.searchParams, 'grantId');

  const { rows: items } = await db.query<{ id: string }>(
    `SELECT ci.id, ci.grant_id AS "grantId", ci.item_index AS "itemIndex",
            ci.item_name AS "itemName", ci.description, ci.required,
            ci.checked, ci.checked_at AS "checkedAt"
     FROM application_checklist_items ci
     WHERE ci.org_id = $1 AND ci.grant_id = $2
     ORDER BY ci.item_index`,
    [orgId, grantId],
  );

  if (items.length === 0) return NextResponse.json([]);

  // Batch load attached documents. Both sides of the join are org-scoped, and the
  // storage URL is never returned — downloads go through /api/documents/download.
  const { rows: links } = await db.query<{ checklist_item_id: string } & Record<string, unknown>>(
    `SELECT cd.checklist_item_id, d.id, d.filename,
            d.content_type AS "contentType", d.size_bytes AS "sizeBytes",
            d.category, d.notes, d.uploaded_at AS "uploadedAt"
     FROM checklist_documents cd
     JOIN documents d ON d.id = cd.document_id AND d.org_id = cd.org_id
     WHERE cd.org_id = $1 AND cd.checklist_item_id = ANY($2::text[])`,
    [orgId, items.map(i => i.id)],
  );

  const docsByItem = new Map<string, Record<string, unknown>[]>();
  for (const { checklist_item_id, ...doc } of links) {
    const list = docsByItem.get(checklist_item_id) ?? [];
    list.push(doc);
    docsByItem.set(checklist_item_id, list);
  }

  return NextResponse.json(
    items.map(item => ({ ...item, documents: docsByItem.get(item.id) ?? [] })),
  );
});

export const POST = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const { grantId } = await parseBody(req, initChecklistSchema);
  const db = getPool();

  // Check if already initialized
  const { rows: existing } = await db.query(
    'SELECT id FROM application_checklist_items WHERE org_id = $1 AND grant_id = $2 LIMIT 1',
    [orgId, grantId],
  );
  if (existing.length > 0) {
    return NextResponse.json({ ok: true, message: 'already initialized' });
  }

  // Seed from the deep search checklist
  const { rows: deepRows } = await db.query(
    'SELECT result_json FROM deep_searches WHERE org_id = $1 AND grant_id = $2',
    [orgId, grantId],
  );
  if (deepRows.length === 0) throw new ApiError(404, 'No deep search data for this grant');

  // Re-validate the stored JSONB before using it to build rows.
  const { checklist } = deepSearchModelOutputSchema.parse({
    checklist: deepRows[0].result_json?.checklist,
  });
  if (checklist.length === 0) {
    return NextResponse.json({ ok: true, message: 'empty checklist' });
  }

  const values: string[] = [];
  const params: unknown[] = [];
  checklist.forEach((item, i) => {
    const base = params.length;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
    params.push(`cli-${crypto.randomUUID()}`, orgId, grantId, i, item.item, item.description, item.required);
  });

  await db.query(
    `INSERT INTO application_checklist_items (id, org_id, grant_id, item_index, item_name, description, required)
     VALUES ${values.join(', ')}
     ON CONFLICT (org_id, grant_id, item_index) DO NOTHING`,
    params,
  );

  return NextResponse.json({ ok: true });
});

export const PUT = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const { id, checked } = await parseBody(req, toggleChecklistSchema);
  const { rowCount } = await getPool().query(
    `UPDATE application_checklist_items
     SET checked = $1, checked_at = CASE WHEN $1 THEN NOW() ELSE NULL END
     WHERE id = $2 AND org_id = $3`,
    [checked, id, orgId],
  );
  if (!rowCount) throw new ApiError(404, 'Checklist item not found');
  return NextResponse.json({ ok: true });
});

export const DELETE = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const grantId = requireIdParam(req.nextUrl.searchParams, 'grantId');
  const db = getPool();
  // Delete links first
  await db.query(
    `DELETE FROM checklist_documents WHERE org_id = $1 AND checklist_item_id IN
     (SELECT id FROM application_checklist_items WHERE org_id = $1 AND grant_id = $2)`,
    [orgId, grantId],
  );
  await db.query(
    'DELETE FROM application_checklist_items WHERE org_id = $1 AND grant_id = $2',
    [orgId, grantId],
  );
  return NextResponse.json({ ok: true });
});
