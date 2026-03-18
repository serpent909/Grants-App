import { GrantOpportunity } from './types';

export interface ShortlistedGrant {
  grant: GrantOpportunity;
  searchTitle: string;
  shortlistedAt: string;
}

const KEY = 'grantShortlist';

function readAll(): Record<string, ShortlistedGrant> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, ShortlistedGrant>) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function isShortlisted(grantId: string): boolean {
  return !!readAll()[grantId];
}

export function addToShortlist(grant: GrantOpportunity, searchTitle: string): void {
  const all = readAll();
  all[grant.id] = { grant, searchTitle, shortlistedAt: new Date().toISOString() };
  writeAll(all);
}

export function removeFromShortlist(grantId: string): void {
  const all = readAll();
  delete all[grantId];
  writeAll(all);
}

export function toggleShortlist(grant: GrantOpportunity, searchTitle: string): boolean {
  if (isShortlisted(grant.id)) {
    removeFromShortlist(grant.id);
    return false;
  }
  addToShortlist(grant, searchTitle);
  return true;
}

export function listShortlisted(): ShortlistedGrant[] {
  return Object.values(readAll()).sort(
    (a, b) => b.shortlistedAt.localeCompare(a.shortlistedAt),
  );
}

export function listShortlistedBySearch(): Record<string, ShortlistedGrant[]> {
  const all = listShortlisted();
  const grouped: Record<string, ShortlistedGrant[]> = {};
  for (const item of all) {
    const key = item.searchTitle || 'Untitled search';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }
  return grouped;
}
