import useSWR, { mutate as globalMutate } from 'swr';
import { ChecklistItem, ChecklistProgress } from './types';

const SWR_OPTS = { revalidateOnFocus: false } as const;

async function invalidateChecklist(grantId?: string) {
  await globalMutate(
    (key: unknown) => typeof key === 'string' && key.startsWith('checklist'),
  );
  // Also invalidate documents since usage counts may change
  if (grantId) {
    await globalMutate('documents');
  }
}

// ─── SWR Hooks ─────────────────────────────────────────────────────────────

export function useChecklist(grantId: string | null) {
  return useSWR<ChecklistItem[]>(
    grantId ? `checklist:${grantId}` : null,
    () => fetch(`/api/checklist?grantId=${grantId}`).then(r => r.ok ? r.json() : []),
    SWR_OPTS,
  );
}

export function useChecklistProgress(grantId: string | null) {
  const { data: items } = useChecklist(grantId);

  if (!items || items.length === 0) return null;

  const progress: ChecklistProgress = {
    total: items.length,
    checked: items.filter(i => i.checked).length,
    requiredTotal: items.filter(i => i.required).length,
    requiredChecked: items.filter(i => i.required && i.checked).length,
  };

  return progress;
}

// ─── Mutations ─────────────────────────────────────────────────────────────

export async function initializeChecklist(grantId: string): Promise<void> {
  await fetch('/api/checklist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grantId }),
  });
  await invalidateChecklist(grantId);
}

export async function toggleChecklistItem(id: string, checked: boolean, grantId: string): Promise<void> {
  const key = `checklist:${grantId}`;

  // Optimistic update: immediately toggle in the SWR cache
  globalMutate(
    key,
    (current: ChecklistItem[] | undefined) =>
      current?.map(item => item.id === id ? { ...item, checked } : item),
    { revalidate: false },
  );

  await fetch('/api/checklist', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, checked }),
  });

  // Background revalidate to sync with server (does not clear data)
  globalMutate(key);
}

export async function attachDocumentToChecklist(checklistItemId: string, documentId: string): Promise<void> {
  await fetch('/api/checklist/attach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checklistItemId, documentId }),
  });
  await invalidateChecklist();
}

export async function detachDocumentFromChecklist(checklistItemId: string, documentId: string): Promise<void> {
  await fetch(`/api/checklist/attach?checklistItemId=${encodeURIComponent(checklistItemId)}&documentId=${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  });
  await invalidateChecklist();
}

export async function deleteChecklist(grantId: string): Promise<void> {
  await fetch(`/api/checklist?grantId=${encodeURIComponent(grantId)}`, { method: 'DELETE' });
  await invalidateChecklist(grantId);
}
