/**
 * Upload rules shared by the browser (pre-flight checks in the dropzone) and
 * the server (authoritative checks in /api/documents/upload).
 */

export const ALLOWED_UPLOAD_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
]);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

export const UPLOAD_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png';

export const UPLOAD_TYPES_LABEL = 'PDF, Word, Excel, JPEG, PNG — max 10MB';
