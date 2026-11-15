import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { getPool, ensureStorageTables } from '@/lib/db';
import { authedRoute, parseBody, requireIdParam, ApiError } from '@/lib/api';
import { updateDocumentSchema } from '@/lib/schemas';
import { isOwnBlobUrl, sanitizeFilename } from '@/lib/document-files';

// Documents are created by POST /api/documents/upload, which stores the file
// and the record together. The storage URL never leaves the server.

export const GET = authedRoute(async (_req, { orgId }) => {
  await ensureStorageTables();
  const { rows } = await getPool().query(
    `SELECT d.id, d.filename, d.content_type AS "contentType",
            d.size_bytes AS "sizeBytes", d.category, d.notes,
            d.uploaded_at AS "uploadedAt",
            COUNT(cd.id)::int AS "usageCount"
     FROM documents d
     LEFT JOIN checklist_documents cd ON cd.document_id = d.id AND cd.org_id = d.org_id
     WHERE d.org_id = $1
     GROUP BY d.id
     ORDER BY d.uploaded_at DESC`,
    [orgId],
  );
  return NextResponse.json(rows);
});

export const PUT = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const { id, filename, category, notes } = await parseBody(req, updateDocumentSchema);

  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filename !== undefined) sets.push(`filename = ${add(sanitizeFilename(filename))}`);
  if (category !== undefined) sets.push(`category = ${add(category)}`);
  if (notes !== undefined) sets.push(`notes = ${add(notes)}`);
  if (sets.length === 0) return NextResponse.json({ ok: true });
  sets.push('updated_at = NOW()');

  const { rowCount } = await getPool().query(
    `UPDATE documents SET ${sets.join(', ')} WHERE id = ${add(id)} AND org_id = ${add(orgId)}`,
    params,
  );
  if (!rowCount) throw new ApiError(404, 'Document not found');
  return NextResponse.json({ ok: true });
});

export const DELETE = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const id = requireIdParam(req.nextUrl.searchParams, 'id');
  const db = getPool();

  // Look up the blob URL first — this also verifies ownership.
  const { rows } = await db.query<{ blob_url: string }>(
    'SELECT blob_url FROM documents WHERE id = $1 AND org_id = $2',
    [id, orgId],
  );
  if (rows.length === 0) return NextResponse.json({ ok: true });

  await db.query('DELETE FROM checklist_documents WHERE document_id = $1 AND org_id = $2', [id, orgId]);
  await db.query('DELETE FROM documents WHERE id = $1 AND org_id = $2', [id, orgId]);

  // Remove the file last, and only ever from our own blob store.
  if (isOwnBlobUrl(rows[0].blob_url)) {
    try { await del(rows[0].blob_url); } catch { /* blob may already be gone */ }
  }

  return NextResponse.json({ ok: true });
});
