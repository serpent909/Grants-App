import { NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';
import { authedRoute, parseBody, requireIdParam, ApiError } from '@/lib/api';
import { attachDocumentSchema } from '@/lib/schemas';

export const POST = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const { checklistItemId, documentId } = await parseBody(req, attachDocumentSchema);
  const db = getPool();

  // Verify ownership of both the checklist item and the document
  const { rows: ciRows } = await db.query(
    'SELECT id FROM application_checklist_items WHERE id = $1 AND org_id = $2',
    [checklistItemId, orgId],
  );
  if (ciRows.length === 0) throw new ApiError(404, 'Checklist item not found');

  const { rows: docRows } = await db.query(
    'SELECT id FROM documents WHERE id = $1 AND org_id = $2',
    [documentId, orgId],
  );
  if (docRows.length === 0) throw new ApiError(404, 'Document not found');

  await db.query(
    `INSERT INTO checklist_documents (id, org_id, checklist_item_id, document_id, attached_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (checklist_item_id, document_id) DO NOTHING`,
    [`cd-${crypto.randomUUID()}`, orgId, checklistItemId, documentId],
  );
  return NextResponse.json({ ok: true });
});

export const DELETE = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const { searchParams } = req.nextUrl;
  const checklistItemId = requireIdParam(searchParams, 'checklistItemId');
  const documentId = requireIdParam(searchParams, 'documentId');

  await getPool().query(
    'DELETE FROM checklist_documents WHERE checklist_item_id = $1 AND document_id = $2 AND org_id = $3',
    [checklistItemId, documentId, orgId],
  );
  return NextResponse.json({ ok: true });
});
