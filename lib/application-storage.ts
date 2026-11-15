import useSWR, { mutate as globalMutate } from 'swr';
import { GrantApplication, ApplicationStatus } from './types';
import { ShortlistedGrant } from './shortlist-storage';
import { apiFetch, json } from './fetcher';

const SWR_OPTS = { revalidateOnFocus: false } as const;

const BY_STATUS_KEY = 'applications:by-status';
const IDS_KEY = 'applications:ids';

type Grouped = Record<ApplicationStatus, GrantApplication[]>;

async function invalidateApplications() {
  await globalMutate(
    (key: unknown) => typeof key === 'string' && key.startsWith('applications'),
  );
}

// ─── SWR Hooks ─────────────────────────────────────────────────────────────

export function useApplicationsByStatus() {
  return useSWR<Grouped>(
    BY_STATUS_KEY,
    async () => {
      const all = await apiFetch<GrantApplication[]>('/api/applications');
      const grouped = emptyGrouped();
      for (const app of all) grouped[app.status]?.push(app);
      return grouped;
    },
    SWR_OPTS,
  );
}

/** IDs of every grant that already has an application. */
export function useApplicationIds() {
  return useSWR<Set<string>>(
    IDS_KEY,
    async () => new Set(await apiFetch<string[]>('/api/applications?idsOnly=true')),
    SWR_OPTS,
  );
}

// ─── Mutations (invalidate SWR cache after write) ──────────────────────────

/** Start tracking an application. The ID, status and history are assigned server-side. */
export async function startApplication(shortlisted: ShortlistedGrant): Promise<GrantApplication> {
  const app = await apiFetch<GrantApplication>(
    '/api/applications',
    json('POST', { grant: shortlisted.grant, searchTitle: shortlisted.searchTitle }),
  );
  await invalidateApplications();
  return app;
}

/** Move an application to a new status. The server appends the history entry. */
export async function updateApplicationStatus(
  grantId: string,
  status: ApplicationStatus,
  note: string = '',
): Promise<void> {
  await apiFetch('/api/applications', json('PUT', { grantId, status, note }));
  await invalidateApplications();
}

export async function updateApplicationNotes(grantId: string, notes: string): Promise<void> {
  await apiFetch('/api/applications', json('PUT', { grantId, notes }));
  // Patch the cache without refetching so the textarea's defaultValue stays in sync.
  patchApplication(grantId, { notes });
}

/** Update tracked amounts. Pass `null` to clear a value. */
export async function updateApplicationAmounts(
  grantId: string,
  amounts: { amountRequested?: number | null; amountAwarded?: number | null },
): Promise<void> {
  // Optimistic update: patch amounts in the SWR cache immediately
  const patch: Partial<GrantApplication> = {};
  if (amounts.amountRequested !== undefined) patch.amountRequested = amounts.amountRequested ?? undefined;
  if (amounts.amountAwarded !== undefined) patch.amountAwarded = amounts.amountAwarded ?? undefined;
  patchApplication(grantId, patch);

  try {
    await apiFetch('/api/applications', json('PUT', { grantId, ...amounts }));
  } finally {
    // Re-sync with the server whether the write succeeded or failed.
    void invalidateApplications();
  }
}

export async function removeApplication(grantId: string): Promise<void> {
  await apiFetch(`/api/applications?grantId=${encodeURIComponent(grantId)}`, { method: 'DELETE' });
  await invalidateApplications();
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function patchApplication(grantId: string, patch: Partial<GrantApplication>) {
  void globalMutate<Grouped>(
    BY_STATUS_KEY,
    current => {
      if (!current) return current;
      const updated = emptyGrouped();
      for (const status of Object.keys(current) as ApplicationStatus[]) {
        updated[status] = current[status].map(app =>
          app.grantId === grantId ? { ...app, ...patch } : app,
        );
      }
      return updated;
    },
    { revalidate: false },
  );
}

export function emptyGrouped(): Grouped {
  return {
    'preparing': [],
    'submitted': [],
    'under-review': [],
    'approved': [],
    'declined': [],
    'withdrawn': [],
  };
}
