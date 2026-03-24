import useSWR, { mutate as globalMutate } from 'swr';
import { GrantApplication, ApplicationStatus } from './types';
import { ShortlistedGrant } from './shortlist-storage';

const SWR_OPTS = { revalidateOnFocus: false } as const;

async function invalidateApplications() {
  await globalMutate(
    (key: unknown) => typeof key === 'string' && key.startsWith('applications'),
    undefined,
    { revalidate: true },
  );
}

// ─── SWR Hooks ─────────────────────────────────────────────────────────────

export function useApplicationsByStatus() {
  return useSWR<Record<ApplicationStatus, GrantApplication[]>>(
    'applications:by-status',
    async () => {
      const res = await fetch('/api/applications');
      if (!res.ok) return emptyGrouped();
      const all: GrantApplication[] = await res.json();
      const grouped = emptyGrouped();
      for (const app of all) grouped[app.status].push(app);
      return grouped;
    },
    SWR_OPTS,
  );
}

export function useApplicationCheck(grantIds: string[]) {
  const key = grantIds.length > 0
    ? `applications:check:${grantIds.slice().sort().join(',')}`
    : null;
  return useSWR<Set<string>>(
    key,
    async () => {
      const res = await fetch(`/api/applications?grantIds=${grantIds.join(',')}`);
      if (!res.ok) return new Set<string>();
      const ids: string[] = await res.json();
      return new Set(ids);
    },
    SWR_OPTS,
  );
}

// ─── Read functions ────────────────────────────────────────────────────────

export async function hasApplication(grantId: string): Promise<boolean> {
  const res = await fetch(`/api/applications?grantId=${encodeURIComponent(grantId)}`);
  if (!res.ok) return false;
  const app = await res.json();
  return app !== null;
}

export async function getApplication(grantId: string): Promise<GrantApplication | null> {
  const res = await fetch(`/api/applications?grantId=${encodeURIComponent(grantId)}`);
  if (!res.ok) return null;
  return res.json();
}

// ─── Mutations (invalidate SWR cache after write) ──────────────────────────

export async function startApplication(shortlisted: ShortlistedGrant): Promise<GrantApplication> {
  const now = new Date().toISOString();
  const app: GrantApplication = {
    id: `app-${Date.now()}`,
    grantId: shortlisted.grant.id,
    grant: shortlisted.grant,
    searchTitle: shortlisted.searchTitle,
    status: 'preparing',
    statusHistory: [{ status: 'preparing', note: 'Application started', updatedAt: now }],
    notes: '',
    startedAt: now,
  };
  await fetch('/api/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(app),
  });
  await invalidateApplications();
  return app;
}

export async function updateApplicationStatus(
  grantId: string,
  status: ApplicationStatus,
  note: string = '',
): Promise<void> {
  const app = await getApplication(grantId);
  if (!app) return;

  const now = new Date().toISOString();
  const statusHistory = [...app.statusHistory, { status, note, updatedAt: now }];
  const updates: Record<string, unknown> = { grantId, status, statusHistory };

  if (status === 'submitted') updates.submittedAt = now;
  if (status === 'approved' || status === 'declined') updates.decidedAt = now;

  await fetch('/api/applications', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  await invalidateApplications();
}

export async function updateApplicationNotes(grantId: string, notes: string): Promise<void> {
  await fetch('/api/applications', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grantId, notes }),
  });
  // Don't invalidate cache for notes — it's managed by defaultValue
}

export async function updateApplicationAmounts(
  grantId: string,
  amountRequested?: number,
  amountAwarded?: number,
): Promise<void> {
  const updates: Record<string, unknown> = { grantId };
  if (amountRequested !== undefined) updates.amountRequested = amountRequested;
  if (amountAwarded !== undefined) updates.amountAwarded = amountAwarded;
  await fetch('/api/applications', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  await invalidateApplications();
}

export async function removeApplication(grantId: string): Promise<void> {
  await fetch(`/api/applications?grantId=${encodeURIComponent(grantId)}`, { method: 'DELETE' });
  await invalidateApplications();
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function emptyGrouped(): Record<ApplicationStatus, GrantApplication[]> {
  return {
    'preparing': [],
    'submitted': [],
    'under-review': [],
    'approved': [],
    'declined': [],
    'withdrawn': [],
  };
}
