import useSWR, { mutate as globalMutate } from 'swr';
import { SearchResult } from './types';

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
  return useSWR<SavedSearch[]>(SWR_KEY,
    () => fetch('/api/saved-searches').then(r => r.ok ? r.json() : []),
    SWR_OPTS,
  );
}

// ─── Read functions ────────────────────────────────────────────────────────

export async function listSaved(): Promise<SavedSearch[]> {
  const res = await fetch('/api/saved-searches');
  if (!res.ok) return [];
  return res.json();
}

export async function getSaved(id: string): Promise<SavedSearch | undefined> {
  const all = await listSaved();
  return all.find(s => s.id === id);
}

// ─── Mutations (invalidate SWR cache after write) ──────────────────────────

export async function saveSearch(name: string, result: SearchResult): Promise<SavedSearch> {
  const entry: SavedSearch = {
    id: `saved-${Date.now()}`,
    name: name.trim() || autoName(result),
    savedAt: new Date().toISOString(),
    grantCount: result.grants.length,
    orgSummary: result.orgSummary || '',
    market: result.market,
    result,
  };
  await fetch('/api/saved-searches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  await globalMutate(SWR_KEY);
  return entry;
}

export async function deleteSaved(id: string): Promise<void> {
  await fetch(`/api/saved-searches?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
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
