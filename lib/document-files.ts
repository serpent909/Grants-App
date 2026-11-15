/**
 * Server-side helpers for stored documents (Vercel Blob).
 */

// Magic byte signatures — keyed by MIME type.
// DOCX/XLSX are ZIP-based; DOC/XLS use the OLE2 compound format.
const MAGIC: Record<string, number[][]> = {
  'application/pdf':    [[0x25, 0x50, 0x44, 0x46]],                    // %PDF
  'application/msword': [[0xD0, 0xCF, 0x11, 0xE0]],                    // OLE2
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [[0x50, 0x4B, 0x03, 0x04]], // PK (ZIP)
  'application/vnd.ms-excel':                                           [[0xD0, 0xCF, 0x11, 0xE0]],      // OLE2
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':  [[0x50, 0x4B, 0x03, 0x04]],      // PK (ZIP)
  'image/png':  [[0x89, 0x50, 0x4E, 0x47]],                            // \x89PNG
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],                                   // JFIF/Exif
};

/** Does the file's leading bytes match the MIME type it claims to be? */
export async function hasValidMagicBytes(file: File): Promise<boolean> {
  const signatures = MAGIC[file.type];
  if (!signatures) return false;
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return signatures.some(sig => sig.every((byte, i) => header[i] === byte));
}

/**
 * Reduce a client-supplied filename to something safe to store and to use as
 * a blob pathname: no directories, no control characters, bounded length.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
  return cleaned || 'document';
}

/**
 * Only ever send the blob read/write token to Vercel Blob itself. Guards the
 * download/delete paths against a stored URL that points anywhere else.
 */
export function isOwnBlobUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && url.hostname.endsWith('.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

/** RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 filename. */
export function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
