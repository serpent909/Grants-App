import { NextRequest, NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';
import { getOrgId } from '@/lib/auth-helpers';
import { initChecklistSchema, toggleChecklistSchema, parseOrError } from '@/lib/schemas';

export async function GET(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const db = getPool();
  const { searchParams } = new URL(req.url);
  const grantId = searchParams.get('grantId');
  if (!grantId) return NextResponse.json({ error: 'grantId required' }, { status: 400 });

  // Get checklist items with attached documents
  const { rows: items } = await db.query(
    `SELECT ci.id, ci.grant_id AS "grantId", ci.item_index AS "itemIndex",
            ci.item_name AS "itemName", ci.description, ci.required,
            ci.checked, ci.checked_at AS "checkedAt"
     FROM application_checklist_items ci
     WHERE ci.org_id = $1 AND ci.grant_id = $2
     ORDER BY ci.item_index`,
    [orgId, grantId],
  );

  if (items.length === 0) return NextResponse.json([]);

  // Batch load attached documents
  const itemIds = items.map((i: { id: string }) => i.id);
  const { rows: links } = await db.query(
    `SELECT cd.checklist_item_id, d.id, d.filename, d.blob_url AS "blobUrl",
            d.content_type AS "contentType", d.size_bytes AS "sizeBytes",
            d.category, d.notes, d.uploaded_at AS "uploadedAt"
     FROM checklist_documents cd
     JOIN documents d ON d.id = cd.document_id
     WHERE cd.checklist_item_id = ANY($1::text[])`,
    [itemIds],
  );

  // Group documents by checklist item
  const docsByItem: Record<string, typeof links> = {};
  for (const link of links) {
    const key = link.checklist_item_id;
    if (!docsByItem[key]) docsByItem[key] = [];
    docsByItem[key].push(link);
  }

  const result = items.map((item: { id: string }) => ({
    ...item,
    documents: (docsByItem[item.id] || []).map(({ checklist_item_id: _, ...doc }) => doc),
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const parsed = parseOrError(initChecklistSchema, await req.json());
  if ('error' in parsed) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { grantId } = parsed.data;

  const db = getPool();

  // Check if already initialized
  const { rows: existing } = await db.query(
    'SELECT id FROM application_checklist_items WHERE org_id = $1 AND grant_id = $2 LIMIT 1',
    [orgId, grantId],
  );
  if (existing.length > 0) {
    return NextResponse.json({ ok: true, message: 'already initialized' });
  }

  // Get deep search checklist
  const { rows: deepRows } = await db.query(
    'SELECT result_json FROM deep_searches WHERE org_id = $1 AND grant_id = $2',
    [orgId, grantId],
  );
  if (deepRows.length === 0) {
    return NextResponse.json({ error: 'no deep search data' }, { status: 404 });
  }

  const result = deepRows[0].result_json;
  const checklist = result.checklist || [];
  if (checklist.length === 0) {
    return NextResponse.json({ ok: true, message: 'empty checklist' });
  }

  // Insert checklist items
  const values: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;
  for (let i = 0; i < checklist.length; i++) {
    const item = checklist[i];
    const id = `cli-${crypto.randomUUID()}`;
    values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
    params.push(id, orgId, grantId, i, item.item, item.description || '', item.required || false);
  }

  await db.query(
    `INSERT INTO application_checklist_items (id, org_id, grant_id, item_index, item_name, description, required)
     VALUES ${values.join(', ')}
     ON CONFLICT (org_id, grant_id, item_index) DO NOTHING`,
    params,
  );

  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const parsed = parseOrError(toggleChecklistSchema, await req.json());
  if ('error' in parsed) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { id, checked } = parsed.data;

  const db = getPool();
  await db.query(
    `UPDATE application_checklist_items SET checked = $1, checked_at = $2 WHERE id = $3 AND org_id = $4`,
    [checked, checked ? new Date().toISOString() : null, id, orgId],
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
  // Delete links first
  await db.query(
    `DELETE FROM checklist_documents WHERE checklist_item_id IN
     (SELECT id FROM application_checklist_items WHERE org_id = $1 AND grant_id = $2)`,
    [orgId, grantId],
  );
  await db.query('DELETE FROM application_checklist_items WHERE org_id = $1 AND grant_id = $2', [orgId, grantId]);
  return NextResponse.json({ ok: true });
}
