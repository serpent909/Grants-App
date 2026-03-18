import useSWR, { mutate as globalMutate } from 'swr';
import { GrantOpportunity } from './types';

export interface ShortlistedGrant {
  grant: GrantOpportunity;
  searchTitle: string;
  shortlistedAt: string;
}

const SWR_OPTS = { revalidateOnFocus: false } as const;

async function invalidateShortlist() {
  await globalMutate(
    (key: unknown) => typeof key === 'string' && key.startsWith('shortlist'),
    undefined,
    { revalidate: true },
  );
}

// ─── SWR Hooks ─────────────────────────────────────────────────────────────

export function useShortlistedBySearch() {
  return useSWR<Record<string, ShortlistedGrant[]>>(
    'shortlist:grouped',
    () => fetch('/api/shortlist?grouped=true').then(r => r.ok ? r.json() : {}),
    SWR_OPTS,
  );
}

// ─── Read functions ────────────────────────────────────────────────────────

export async function isShortlisted(grantId: string): Promise<boolean> {
  const res = await fetch(`/api/shortlist?grantIds=${encodeURIComponent(grantId)}`);
  if (!res.ok) return false;
  const ids: string[] = await res.json();
  return ids.includes(grantId);
}

export async function listShortlisted(): Promise<ShortlistedGrant[]> {
  const res = await fetch('/api/shortlist');
  if (!res.ok) return [];
  return res.json();
}

export async function listShortlistedBySearch(): Promise<Record<string, ShortlistedGrant[]>> {
  const res = await fetch('/api/shortlist?grouped=true');
  if (!res.ok) return {};
  return res.json();
}

export async function batchCheckShortlisted(grantIds: string[]): Promise<Set<string>> {
  if (grantIds.length === 0) return new Set();
  const res = await fetch(`/api/shortlist?grantIds=${grantIds.join(',')}`);
  if (!res.ok) return new Set();
  const ids: string[] = await res.json();
  return new Set(ids);
}

// ─── Mutations (invalidate SWR cache after write) ──────────────────────────

export async function addToShortlist(grant: GrantOpportunity, searchTitle: string): Promise<void> {
  await fetch('/api/shortlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant, searchTitle }),
  });
  await invalidateShortlist();
}

export async function removeFromShortlist(grantId: string): Promise<void> {
  await fetch(`/api/shortlist?grantId=${encodeURIComponent(grantId)}`, { method: 'DELETE' });
  await invalidateShortlist();
}

export async function toggleShortlist(grant: GrantOpportunity, searchTitle: string): Promise<boolean> {
  const shortlisted = await isShortlisted(grant.id);
  if (shortlisted) {
    await removeFromShortlist(grant.id);
    return false;
  }
  await addToShortlist(grant, searchTitle);
  return true;
}
