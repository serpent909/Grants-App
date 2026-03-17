import { DeepSearchResult } from './types';

const KEY = 'grantDeepSearch';

function readAll(): Record<string, DeepSearchResult> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, DeepSearchResult>) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function getDeepSearch(grantId: string): DeepSearchResult | undefined {
  return readAll()[grantId];
}

export function saveDeepSearch(result: DeepSearchResult): void {
  const all = readAll();
  all[result.grantId] = result;
  writeAll(all);
}

export function hasDeepSearch(grantId: string): boolean {
  return !!readAll()[grantId];
}

export function deleteDeepSearch(grantId: string): void {
  const all = readAll();
  delete all[grantId];
  writeAll(all);
}
