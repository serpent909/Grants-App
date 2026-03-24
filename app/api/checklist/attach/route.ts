import { NextRequest, NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';
import { getOrgId } from '@/lib/auth-helpers';

export async function POST(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const { checklistItemId, documentId } = await req.json();
  if (!checklistItemId || !documentId) {
    return NextResponse.json({ error: 'checklistItemId and documentId required' }, { status: 400 });
  }

  const db = getPool();

  // Verify ownership of both checklist item and document
  const { rows: ciRows } = await db.query(
    'SELECT id FROM application_checklist_items WHERE id = $1 AND org_id = $2',
    [checklistItemId, orgId],
  );
  if (ciRows.length === 0) return NextResponse.json({ error: 'checklist item not found' }, { status: 404 });

  const { rows: docRows } = await db.query(
    'SELECT id FROM documents WHERE id = $1 AND org_id = $2',
    [documentId, orgId],
  );
  if (docRows.length === 0) return NextResponse.json({ error: 'document not found' }, { status: 404 });

  const id = `cd-${Date.now()}`;
  await db.query(
    `INSERT INTO checklist_documents (id, org_id, checklist_item_id, document_id, attached_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (checklist_item_id, document_id) DO NOTHING`,
    [id, orgId, checklistItemId, documentId],
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const { searchParams } = new URL(req.url);
  const checklistItemId = searchParams.get('checklistItemId');
  const documentId = searchParams.get('documentId');
  if (!checklistItemId || !documentId) {
    return NextResponse.json({ error: 'checklistItemId and documentId required' }, { status: 400 });
  }

  const db = getPool();
  await db.query(
    'DELETE FROM checklist_documents WHERE checklist_item_id = $1 AND document_id = $2 AND org_id = $3',
    [checklistItemId, documentId, orgId],
  );
  return NextResponse.json({ ok: true });
}
