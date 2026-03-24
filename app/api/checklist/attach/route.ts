import { NextRequest, NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';

export async function POST(req: NextRequest) {
  await ensureStorageTables();
  const { checklistItemId, documentId } = await req.json();
  if (!checklistItemId || !documentId) {
    return NextResponse.json({ error: 'checklistItemId and documentId required' }, { status: 400 });
  }

  const db = getPool();
  const id = `cd-${Date.now()}`;
  await db.query(
    `INSERT INTO checklist_documents (id, checklist_item_id, document_id, attached_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (checklist_item_id, document_id) DO NOTHING`,
    [id, checklistItemId, documentId],
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await ensureStorageTables();
  const { searchParams } = new URL(req.url);
  const checklistItemId = searchParams.get('checklistItemId');
  const documentId = searchParams.get('documentId');
  if (!checklistItemId || !documentId) {
    return NextResponse.json({ error: 'checklistItemId and documentId required' }, { status: 400 });
  }

  const db = getPool();
  await db.query(
    'DELETE FROM checklist_documents WHERE checklist_item_id = $1 AND document_id = $2',
    [checklistItemId, documentId],
  );
  return NextResponse.json({ ok: true });
}
