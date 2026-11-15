import { getPool, ensureStorageTables } from '@/lib/db';
import { authedRoute, requireIdParam, ApiError } from '@/lib/api';
import { ALLOWED_UPLOAD_TYPES } from '@/lib/upload-rules';
import { isOwnBlobUrl, attachmentDisposition } from '@/lib/document-files';

export const GET = authedRoute(async (req, { orgId }) => {
  await ensureStorageTables();
  const id = requireIdParam(req.nextUrl.searchParams, 'id');

  const { rows } = await getPool().query<{ blob_url: string; filename: string; content_type: string }>(
    'SELECT blob_url, filename, content_type FROM documents WHERE id = $1 AND org_id = $2',
    [id, orgId],
  );
  if (rows.length === 0) throw new ApiError(404, 'Document not found');

  const { blob_url, filename, content_type } = rows[0];

  // The storage token must only ever be sent to Vercel Blob. Refuse to fetch a
  // stored URL that points anywhere else (SSRF / token exfiltration guard).
  if (!isOwnBlobUrl(blob_url)) {
    console.error(`[documents] Refusing to fetch non-blob URL for document ${id}`);
    throw new ApiError(404, 'Document not found');
  }

  const blobRes = await fetch(blob_url, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  });

  if (!blobRes.ok || !blobRes.body) {
    console.error('[documents] Blob fetch failed:', blobRes.status, blobRes.statusText);
    throw new ApiError(502, 'Failed to retrieve file');
  }

  // Stream the file to the client. Always an attachment, never rendered inline,
  // and only with a content type from the upload allowlist.
  return new Response(blobRes.body, {
    headers: {
      'Content-Type': ALLOWED_UPLOAD_TYPES.has(content_type) ? content_type : 'application/octet-stream',
      'Content-Disposition': attachmentDisposition(filename),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
