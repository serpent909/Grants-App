import useSWR, { mutate as globalMutate } from 'swr';
import { DeepSearchResult, GrantOpportunity, OrgInfo } from './types';
import { apiFetch, json } from './fetcher';

const SWR_OPTS = { revalidateOnFocus: false } as const;

/** Drop cached deep-search data so every page picks up a new result. */
export async function invalidateDeepSearch() {
  await globalMutate(
    (key: unknown) => typeof key === 'string' && key.startsWith('deep-search'),
  );
}

// ─── SWR Hooks ─────────────────────────────────────────────────────────────

export function useDeepSearch(grantId: string | null) {
  return useSWR<DeepSearchResult | null>(
    grantId ? `deep-search:${grantId}` : null,
    () => apiFetch<DeepSearchResult | null>(`/api/deep-search-results?grantId=${encodeURIComponent(grantId!)}`),
    SWR_OPTS,
  );
}

/** All of this org's deep-search results, keyed by grant ID. */
export function useDeepSearchMap() {
  return useSWR<Map<string, DeepSearchResult>>(
    'deep-search:all',
    getAllDeepSearches,
    SWR_OPTS,
  );
}

// ─── Read functions ────────────────────────────────────────────────────────

export async function getAllDeepSearches(): Promise<Map<string, DeepSearchResult>> {
  const rows = await apiFetch<{ grantId: string; result: DeepSearchResult }[]>('/api/deep-search-results');
  return new Map(rows.map(row => [row.grantId, row.result]));
}

// ─── Run a deep search ─────────────────────────────────────────────────────

/**
 * Research one grant in depth. The server looks the grant up itself, runs the
 * research, stores the result for this org and returns it — there is no
 * separate "save" step.
 */
export async function runDeepSearch(
  grant: GrantOpportunity,
  orgContext: OrgInfo,
  market: string,
): Promise<DeepSearchResult> {
  const result = await apiFetch<DeepSearchResult>('/api/deep-search', json('POST', {
    grant: {
      id: grant.id,
      name: grant.name,
      funder: grant.funder,
      url: grant.url,
      description: grant.description,
      scores: grant.scores,
      alignmentReason: grant.alignmentReason,
      applicationNotes: grant.applicationNotes,
      attainabilityNotes: grant.attainabilityNotes,
      amountMin: grant.amountMin,
      amountMax: grant.amountMax,
      deadline: grant.deadline,
    },
    orgContext,
    market,
  }));
  await invalidateDeepSearch();
  return result;
}

export async function deleteDeepSearch(grantId: string): Promise<void> {
  await apiFetch(`/api/deep-search-results?grantId=${encodeURIComponent(grantId)}`, { method: 'DELETE' });
  await invalidateDeepSearch();
}
