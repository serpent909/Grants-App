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

const KEY = 'grantSearchSaved';

function read(): SavedSearch[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

function write(items: SavedSearch[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function listSaved(): SavedSearch[] {
  return read().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function saveSearch(name: string, result: SearchResult): SavedSearch {
  const items = read();
  const entry: SavedSearch = {
    id: `saved-${Date.now()}`,
    name: name.trim() || autoName(result),
    savedAt: new Date().toISOString(),
    grantCount: result.grants.length,
    orgSummary: result.orgSummary || '',
    market: result.market,
    result,
  };
  write([entry, ...items]);
  return entry;
}

export function updateSaved(id: string, result: SearchResult): void {
  const items = read();
  const idx = items.findIndex(s => s.id === id);
  if (idx === -1) return;
  items[idx] = {
    ...items[idx],
    savedAt: new Date().toISOString(),
    grantCount: result.grants.length,
    orgSummary: result.orgSummary || '',
    result,
  };
  write(items);
}

export function deleteSaved(id: string): void {
  write(read().filter(s => s.id !== id));
}

export function getSaved(id: string): SavedSearch | undefined {
  return read().find(s => s.id === id);
}

export function autoName(result: SearchResult): string {
  const date = new Date(result.searchedAt).toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  // Try to extract org name from the summary (first few words before a comma or verb)
  const summary = result.orgSummary || '';
  const orgHint = summary.split(/[,.]|( is | provides | supports | helps )/)[0]?.trim().slice(0, 40);
  return orgHint ? `${orgHint} — ${date}` : `Search — ${date}`;
}
