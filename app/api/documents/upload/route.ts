import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getOrgId } from '@/lib/auth-helpers';
import { uploadLimiter, checkRateLimit } from '@/lib/rate-limit';

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
]);

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

// Magic byte signatures — keyed by MIME type
// DOCX/XLSX are ZIP-based; DOC/XLS use OLE2 compound format
const MAGIC: Record<string, number[][]> = {
  'application/pdf':    [[0x25, 0x50, 0x44, 0x46]],                    // %PDF
  'application/msword': [[0xD0, 0xCF, 0x11, 0xE0]],                    // OLE2
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [[0x50, 0x4B, 0x03, 0x04]], // PK (ZIP)
  'application/vnd.ms-excel':                                           [[0xD0, 0xCF, 0x11, 0xE0]],      // OLE2
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':  [[0x50, 0x4B, 0x03, 0x04]],      // PK (ZIP)
  'image/png':  [[0x89, 0x50, 0x4E, 0x47]],                            // \x89PNG
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],                                   // JFIF/Exif
};

async function hasValidMagicBytes(file: File): Promise<boolean> {
  const signatures = MAGIC[file.type];
  if (!signatures) return false;
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return signatures.some(sig => sig.every((byte, i) => header[i] === byte));
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId();
  const blocked = await checkRateLimit(uploadLimiter, orgId);
  if (blocked) return blocked;

  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
  }

  if (!(await hasValidMagicBytes(file))) {
    return NextResponse.json({ error: 'File content does not match declared type' }, { status: 400 });
  }

  const blob = await put(file.name, file, {
    access: 'private',
    addRandomSuffix: true,
  });

  return NextResponse.json({ url: blob.url });
}
