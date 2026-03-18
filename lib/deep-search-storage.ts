import useSWR, { mutate as globalMutate } from 'swr';
import { DeepSearchResult } from './types';

const SWR_OPTS = { revalidateOnFocus: false } as const;

async function invalidateDeepSearch() {
  await globalMutate(
    (key: unknown) => typeof key === 'string' && key.startsWith('deep-search'),
    undefined,
    { revalidate: true },
  );
}

// ─── SWR Hooks ─────────────────────────────────────────────────────────────

export function useDeepSearch(grantId: string | null) {
  return useSWR<DeepSearchResult | null>(
    grantId ? `deep-search:${grantId}` : null,
    () => fetch(`/api/deep-search-results?grantId=${encodeURIComponent(grantId!)}`).then(r => r.ok ? r.json() : null),
    SWR_OPTS,
  );
}

export function useDeepSearchBatch(grantIds: string[]) {
  const key = grantIds.length > 0
    ? `deep-search:batch:${grantIds.slice().sort().join(',')}`
    : null;
  return useSWR<Map<string, DeepSearchResult>>(
    key,
    () => batchGetDeepSearch(grantIds),
    SWR_OPTS,
  );
}

// ─── Read functions ────────────────────────────────────────────────────────

export async function getDeepSearch(grantId: string): Promise<DeepSearchResult | null> {
  const res = await fetch(`/api/deep-search-results?grantId=${encodeURIComponent(grantId)}`);
  if (!res.ok) return null;
  return res.json();
}

export async function hasDeepSearch(grantId: string): Promise<boolean> {
  const result = await getDeepSearch(grantId);
  return result !== null;
}

export async function batchCheckDeepSearch(grantIds: string[]): Promise<Map<string, string>> {
  if (grantIds.length === 0) return new Map();
  const res = await fetch(`/api/deep-search-results?grantIds=${grantIds.join(',')}`);
  if (!res.ok) return new Map();
  const rows: { id: string; searchedAt: string }[] = await res.json();
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.id, row.searchedAt);
  }
  return map;
}

export async function batchGetDeepSearch(grantIds: string[]): Promise<Map<string, DeepSearchResult>> {
  const res = await fetch('/api/deep-search-results');
  if (!res.ok) return new Map();
  const rows: { grantId: string; result: DeepSearchResult }[] = await res.json();
  const map = new Map<string, DeepSearchResult>();
  for (const row of rows) {
    if (grantIds.includes(row.grantId)) {
      map.set(row.grantId, row.result);
    }
  }
  return map;
}

// ─── Mutations (invalidate SWR cache after write) ──────────────────────────

export async function saveDeepSearch(result: DeepSearchResult): Promise<void> {
  await fetch('/api/deep-search-results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  });
  await invalidateDeepSearch();
}

export async function deleteDeepSearch(grantId: string): Promise<void> {
  await fetch(`/api/deep-search-results?grantId=${encodeURIComponent(grantId)}`, { method: 'DELETE' });
  await invalidateDeepSearch();
}
