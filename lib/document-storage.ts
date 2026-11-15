import useSWR, { mutate as globalMutate } from 'swr';
import { AppDocument } from './types';
import type { DocumentCategory } from './document-categories';
import { mapChecklistToCategory } from './document-categories';
import { apiFetch, json } from './fetcher';

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
    () => apiFetch<AppDocument[]>('/api/documents'),
    SWR_OPTS,
  );
}

// ─── Mutations ─────────────────────────────────────────────────────────────

/**
 * Upload a file to the document library. One request: the server stores the
 * file and creates the record, and the storage URL never reaches the browser.
 */
export async function uploadDocument(
  file: File,
  options?: { category?: DocumentCategory; checklistItemName?: string },
): Promise<AppDocument> {
  const category = options?.category
    ?? mapChecklistToCategory(options?.checklistItemName ?? '');

  const formData = new FormData();
  formData.append('file', file);
  formData.append('category', category);

  const doc = await apiFetch<AppDocument>('/api/documents/upload', { method: 'POST', body: formData });
  await invalidateDocuments();
  return doc;
}

export async function updateDocument(
  id: string,
  updates: Partial<Pick<AppDocument, 'filename' | 'category' | 'notes'>>,
): Promise<void> {
  await apiFetch('/api/documents', json('PUT', { id, ...updates }));
  await invalidateDocuments();
}

export async function deleteDocument(id: string): Promise<void> {
  await apiFetch(`/api/documents?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  await invalidateDocuments();
  // Also invalidate checklist caches since links were removed
  await globalMutate(
    (key: unknown) => typeof key === 'string' && key.startsWith('checklist'),
  );
}

/** Download a document through the authenticated API route and save it. */
export async function downloadDocument(id: string, filename: string): Promise<void> {
  const res = await fetch(`/api/documents/download?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('Could not download this document. Please try again.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
