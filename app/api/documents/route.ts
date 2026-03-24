import { NextRequest, NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { getPool, ensureStorageTables } from '@/lib/db';
import { getOrgId } from '@/lib/auth-helpers';

export async function GET() {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const db = getPool();
  const { rows } = await db.query(`
    SELECT d.id, d.filename, d.blob_url AS "blobUrl", d.content_type AS "contentType",
           d.size_bytes AS "sizeBytes", d.category, d.notes,
           d.uploaded_at AS "uploadedAt",
           COUNT(cd.id)::int AS "usageCount"
    FROM documents d
    LEFT JOIN checklist_documents cd ON cd.document_id = d.id
    WHERE d.org_id = $1
    GROUP BY d.id
    ORDER BY d.uploaded_at DESC
  `, [orgId]);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const { id, filename, blobUrl, contentType, sizeBytes, category, notes } = await req.json();
  const db = getPool();
  await db.query(
    `INSERT INTO documents (id, org_id, filename, blob_url, content_type, size_bytes, category, notes, uploaded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [id, orgId, filename, blobUrl, contentType, sizeBytes, category || 'other', notes || ''],
  );
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const { id, filename, category, notes } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const db = getPool();
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (filename !== undefined) { sets.push(`filename = $${i++}`); vals.push(filename); }
  if (category !== undefined) { sets.push(`category = $${i++}`); vals.push(category); }
  if (notes !== undefined) { sets.push(`notes = $${i++}`); vals.push(notes); }
  if (sets.length === 0) return NextResponse.json({ ok: true });
  sets.push(`updated_at = NOW()`);
  vals.push(id, orgId);
  await db.query(`UPDATE documents SET ${sets.join(', ')} WHERE id = $${i} AND org_id = $${i + 1}`, vals);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const orgId = await getOrgId();
  await ensureStorageTables();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getPool();

  // Get blob URL before deleting record — verify ownership
  const { rows } = await db.query('SELECT blob_url FROM documents WHERE id = $1 AND org_id = $2', [id, orgId]);
  if (rows.length > 0) {
    // Remove all checklist links
    await db.query('DELETE FROM checklist_documents WHERE document_id = $1', [id]);
    // Delete DB record
    await db.query('DELETE FROM documents WHERE id = $1 AND org_id = $2', [id, orgId]);
    // Delete from blob storage
    try { await del(rows[0].blob_url); } catch { /* blob may already be gone */ }
  }

  return NextResponse.json({ ok: true });
}
