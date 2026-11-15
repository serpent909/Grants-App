import useSWR, { mutate as globalMutate } from 'swr';
import { ChecklistItem, ChecklistProgress } from './types';
import { apiFetch, json } from './fetcher';

const SWR_OPTS = { revalidateOnFocus: false } as const;

async function invalidateChecklist() {
  await globalMutate(
    (key: unknown) => typeof key === 'string' && key.startsWith('checklist'),
  );
  // Document usage counts depend on checklist links.
  await globalMutate('documents');
}

// ─── SWR Hooks ─────────────────────────────────────────────────────────────

export function useChecklist(grantId: string | null) {
  return useSWR<ChecklistItem[]>(
    grantId ? `checklist:${grantId}` : null,
    () => apiFetch<ChecklistItem[]>(`/api/checklist?grantId=${encodeURIComponent(grantId!)}`),
    SWR_OPTS,
  );
}

export function useChecklistProgress(grantId: string | null): ChecklistProgress | null {
  const { data: items } = useChecklist(grantId);

  if (!items || items.length === 0) return null;

  return {
    total: items.length,
    checked: items.filter(i => i.checked).length,
    requiredTotal: items.filter(i => i.required).length,
    requiredChecked: items.filter(i => i.required && i.checked).length,
  };
}

// ─── Mutations ─────────────────────────────────────────────────────────────

export async function initializeChecklist(grantId: string): Promise<void> {
  await apiFetch('/api/checklist', json('POST', { grantId }));
  await invalidateChecklist();
}

export async function toggleChecklistItem(id: string, checked: boolean, grantId: string): Promise<void> {
  const key = `checklist:${grantId}`;

  // Optimistic update: immediately toggle in the SWR cache
  void globalMutate<ChecklistItem[]>(
    key,
    current => current?.map(item => (item.id === id ? { ...item, checked } : item)),
    { revalidate: false },
  );

  try {
    await apiFetch('/api/checklist', json('PUT', { id, checked }));
  } finally {
    // Re-sync with the server — this also rolls the toggle back if the write failed.
    void globalMutate(key);
  }
}

export async function attachDocumentToChecklist(checklistItemId: string, documentId: string): Promise<void> {
  await apiFetch('/api/checklist/attach', json('POST', { checklistItemId, documentId }));
  await invalidateChecklist();
}

export async function detachDocumentFromChecklist(checklistItemId: string, documentId: string): Promise<void> {
  await apiFetch(
    `/api/checklist/attach?checklistItemId=${encodeURIComponent(checklistItemId)}&documentId=${encodeURIComponent(documentId)}`,
    { method: 'DELETE' },
  );
  await invalidateChecklist();
}

export async function deleteChecklist(grantId: string): Promise<void> {
  await apiFetch(`/api/checklist?grantId=${encodeURIComponent(grantId)}`, { method: 'DELETE' });
  await invalidateChecklist();
}
