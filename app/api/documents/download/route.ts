import { NextRequest, NextResponse } from 'next/server';
import { getPool, ensureStorageTables } from '@/lib/db';

export async function GET(req: NextRequest) {
  await ensureStorageTables();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getPool();
  const { rows } = await db.query('SELECT blob_url, filename, content_type FROM documents WHERE id = $1', [id]);
  if (rows.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { blob_url, filename, content_type } = rows[0];

  // Fetch the file server-side using the BLOB_READ_WRITE_TOKEN for auth
  const blobRes = await fetch(blob_url, {
    headers: {
      Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
    },
  });

  if (!blobRes.ok) {
    console.error('Blob fetch failed:', blobRes.status, blobRes.statusText);
    return NextResponse.json({ error: 'Failed to retrieve file' }, { status: 502 });
  }

  const body = blobRes.body;
  if (!body) {
    return NextResponse.json({ error: 'Empty response from storage' }, { status: 502 });
  }

  // Stream the file to the client with proper headers
  return new NextResponse(body as ReadableStream, {
    headers: {
      'Content-Type': content_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
