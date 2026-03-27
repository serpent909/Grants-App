import useSWR, { mutate as globalMutate } from 'swr';
import { AppDocument } from './types';
import type { DocumentCategory } from './document-categories';
import { mapChecklistToCategory } from './document-categories';

const SWR_KEY = 'documents';
const SWR_OPTS = { revalidateOnFocus: false } as const;

async function invalidateDocuments() {
  await globalMutate(
    (key: unknown) => typeof key === 'string' && key.startsWith('documents'),
  );
}

// ─── SWR Hooks ─────────────────────────────────────────────────────────────

export function useDocuments() {
  return useSWR<AppDocument[]>(
    SWR_KEY,
    () => fetch('/api/documents').then(r => r.ok ? r.json() : []),
    SWR_OPTS,
  );
}

// ─── Mutations ─────────────────────────────────────────────────────────────

export async function uploadDocument(
  file: File,
  options?: { category?: DocumentCategory; checklistItemName?: string },
): Promise<AppDocument> {
  // Upload to Vercel Blob via server route
  const formData = new FormData();
  formData.append('file', file);
  const uploadRes = await fetch('/api/documents/upload', { method: 'POST', body: formData });
  if (!uploadRes.ok) {
    const err = await uploadRes.json();
    throw new Error(err.error || 'Upload failed');
  }
  const blob = await uploadRes.json();

  const category = options?.category
    ?? mapChecklistToCategory(options?.checklistItemName ?? '');

  const doc: AppDocument = {
    id: `doc-${Date.now()}`,
    filename: file.name,
    blobUrl: blob.url,
    contentType: file.type,
    sizeBytes: file.size,
    category,
    notes: '',
    uploadedAt: new Date().toISOString(),
  };

  await fetch('/api/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });

  await invalidateDocuments();
  return doc;
}

export async function updateDocument(
  id: string,
  updates: Partial<Pick<AppDocument, 'filename' | 'category' | 'notes'>>,
): Promise<void> {
  await fetch('/api/documents', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...updates }),
  });
  await invalidateDocuments();
}

export async function deleteDocument(id: string): Promise<void> {
  await fetch(`/api/documents?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  await invalidateDocuments();
  // Also invalidate checklist caches since links were removed
  await globalMutate(
    (key: unknown) => typeof key === 'string' && key.startsWith('checklist'),
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileTypeIcon(contentType: string): 'pdf' | 'word' | 'excel' | 'image' | 'file' {
  if (contentType.includes('pdf')) return 'pdf';
  if (contentType.includes('word') || contentType.includes('document')) return 'word';
  if (contentType.includes('excel') || contentType.includes('sheet')) return 'excel';
  if (contentType.startsWith('image/')) return 'image';
  return 'file';
}
