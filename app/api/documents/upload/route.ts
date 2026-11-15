import { NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import { getPool, ensureStorageTables } from '@/lib/db';
import { authedRoute, enforceRateLimit, ApiError } from '@/lib/api';
import { uploadLimiter } from '@/lib/rate-limit';
import { documentCategorySchema } from '@/lib/schemas';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from '@/lib/upload-rules';
import { hasValidMagicBytes, sanitizeFilename } from '@/lib/document-files';

/**
 * Upload a file and create its document record in one step.
 *
 * The storage URL is generated here and written straight to the database — it
 * is never accepted from, or returned to, the client. (Previously the client
 * posted the blob URL back in a second request, which let a caller register an
 * arbitrary URL that the download route would then fetch with the storage token.)
 */
export const POST = authedRoute(async (req, { orgId }) => {
  await enforceRateLimit(uploadLimiter, orgId);
  await ensureStorageTables();

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    throw new ApiError(400, 'Invalid upload');
  }

  const file = formData.get('file');
  if (!(file instanceof File)) throw new ApiError(400, 'No file provided');
  if (!ALLOWED_UPLOAD_TYPES.has(file.type)) throw new ApiError(400, 'File type not allowed');
  if (file.size === 0) throw new ApiError(400, 'File is empty');
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(400, 'File too large (max 10MB)');
  if (!(await hasValidMagicBytes(file))) {
    throw new ApiError(400, 'File content does not match declared type');
  }

  const categoryInput = formData.get('category');
  const parsedCategory = documentCategorySchema.safeParse(categoryInput);
  const category = parsedCategory.success ? parsedCategory.data : 'other';

  const filename = sanitizeFilename(file.name);

  // Namespace blobs by org so storage mirrors tenancy.
  const blob = await put(`${orgId}/${filename}`, file, {
    access: 'private',
    addRandomSuffix: true,
    contentType: file.type,
  });

  const id = `doc_${crypto.randomUUID()}`;
  try {
    const { rows } = await getPool().query(
      `INSERT INTO documents (id, org_id, filename, blob_url, content_type, size_bytes, category, notes, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '', NOW())
       RETURNING id, filename, content_type AS "contentType", size_bytes AS "sizeBytes",
                 category, notes, uploaded_at AS "uploadedAt"`,
      [id, orgId, filename, blob.url, file.type, file.size, category],
    );
    return NextResponse.json(rows[0]);
  } catch (err) {
    // Don't leave an orphaned blob behind if the record could not be created.
    try { await del(blob.url); } catch { /* best effort */ }
    throw err;
  }
});
