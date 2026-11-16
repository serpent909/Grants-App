import useSWR, { mutate as globalMutate } from 'swr';
import { SearchResult } from './types';
import { apiFetch, json, ApiRequestError } from './fetcher';

export interface SavedSearch {
  id: string;
  name: string;
  savedAt: string;
  grantCount: number;
  orgSummary: string;
  market: string;
  result: SearchResult;
}

const SWR_KEY = 'saved-searches';
const SWR_OPTS = { revalidateOnFocus: false } as const;

// ─── SWR Hook ──────────────────────────────────────────────────────────────

export function useSavedSearches() {
  return useSWR<SavedSearch[]>(
    SWR_KEY,
    () => apiFetch<SavedSearch[]>('/api/saved-searches'),
    SWR_OPTS,
  );
}

// ─── Read functions ────────────────────────────────────────────────────────

/** Load one saved search by ID. Resolves to undefined if it no longer exists. */
export async function getSaved(id: string): Promise<SavedSearch | undefined> {
  try {
    return await apiFetch<SavedSearch>(`/api/saved-searches?id=${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) return undefined;
    throw err;
  }
}

// ─── Mutations (invalidate SWR cache after write) ──────────────────────────

/** Save a search result. The server assigns the ID and timestamp. */
export async function saveSearch(name: string, result: SearchResult): Promise<SavedSearch> {
  const saved = await apiFetch<SavedSearch>(
    '/api/saved-searches',
    json('POST', { name: name.trim() || autoName(result), result }),
  );
  await globalMutate(SWR_KEY);
  return saved;
}

/**
 * Replace a saved search's results (used when a search is re-run), keeping its
 * ID and name. Resolves to undefined if the search no longer exists.
 */
export async function updateSaved(id: string, result: SearchResult): Promise<SavedSearch | undefined> {
  try {
    const saved = await apiFetch<SavedSearch>('/api/saved-searches', json('PUT', { id, result }));
    await globalMutate(SWR_KEY);
    return saved;
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) return undefined;
    throw err;
  }
}

export async function deleteSaved(id: string): Promise<void> {
  await apiFetch(`/api/saved-searches?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  await globalMutate(SWR_KEY);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function autoName(result: SearchResult): string {
  const date = new Date(result.searchedAt).toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  const summary = result.orgSummary || '';
  const orgHint = summary.split(/[,.]|( is | provides | supports | helps )/)[0]?.trim().slice(0, 40);
  return orgHint ? `${orgHint} — ${date}` : `Search — ${date}`;
}
