import useSWR, { mutate as globalMutate } from 'swr';
import { GrantOpportunity } from './types';
import { apiFetch, json } from './fetcher';

export interface ShortlistedGrant {
  grant: GrantOpportunity;
  searchTitle: string;
  shortlistedAt: string;
}

const SWR_OPTS = { revalidateOnFocus: false } as const;

async function invalidateShortlist() {
  await globalMutate(
    (key: unknown) => typeof key === 'string' && key.startsWith('shortlist'),
  );
}

// ─── SWR Hooks ─────────────────────────────────────────────────────────────

export function useShortlistedBySearch() {
  return useSWR<Record<string, ShortlistedGrant[]>>(
    'shortlist:grouped',
    () => apiFetch<Record<string, ShortlistedGrant[]>>('/api/shortlist?grouped=true'),
    SWR_OPTS,
  );
}

// ─── Read functions ────────────────────────────────────────────────────────

/**
 * Fetch all shortlisted grant IDs (lightweight — no grant JSON).
 * Callers intersect with the IDs they care about; this avoids putting hundreds
 * of IDs in a query string, which overflowed URL limits on large result sets.
 */
export async function getAllShortlistedIds(): Promise<Set<string>> {
  return new Set(await apiFetch<string[]>('/api/shortlist?idsOnly=true'));
}

// ─── Mutations (invalidate SWR cache after write) ──────────────────────────

export async function addToShortlist(grant: GrantOpportunity, searchTitle: string): Promise<void> {
  await apiFetch('/api/shortlist', json('POST', { grant, searchTitle }));
  await invalidateShortlist();
}

export async function removeFromShortlist(grantId: string): Promise<void> {
  await apiFetch(`/api/shortlist?grantId=${encodeURIComponent(grantId)}`, { method: 'DELETE' });
  await invalidateShortlist();
}
