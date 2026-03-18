import { GrantApplication, ApplicationStatus } from './types';
import { ShortlistedGrant } from './shortlist-storage';

const KEY = 'grantApplications';

function readAll(): Record<string, GrantApplication> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, GrantApplication>) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function hasApplication(grantId: string): boolean {
  return !!readAll()[grantId];
}

export function getApplication(grantId: string): GrantApplication | undefined {
  return readAll()[grantId];
}

export function startApplication(shortlisted: ShortlistedGrant): GrantApplication {
  const all = readAll();
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
  all[shortlisted.grant.id] = app;
  writeAll(all);
  return app;
}

export function updateApplicationStatus(
  grantId: string,
  status: ApplicationStatus,
  note: string = '',
): void {
  const all = readAll();
  const app = all[grantId];
  if (!app) return;

  const now = new Date().toISOString();
  app.status = status;
  app.statusHistory.push({ status, note, updatedAt: now });

  if (status === 'submitted') app.submittedAt = now;
  if (status === 'approved' || status === 'declined') app.decidedAt = now;

  writeAll(all);
}

export function updateApplicationNotes(grantId: string, notes: string): void {
  const all = readAll();
  const app = all[grantId];
  if (!app) return;
  app.notes = notes;
  writeAll(all);
}

export function updateApplicationAmounts(
  grantId: string,
  amountRequested?: number,
  amountAwarded?: number,
): void {
  const all = readAll();
  const app = all[grantId];
  if (!app) return;
  if (amountRequested !== undefined) app.amountRequested = amountRequested;
  if (amountAwarded !== undefined) app.amountAwarded = amountAwarded;
  writeAll(all);
}

export function removeApplication(grantId: string): void {
  const all = readAll();
  delete all[grantId];
  writeAll(all);
}

export function listApplications(): GrantApplication[] {
  return Object.values(readAll()).sort((a, b) => {
    const aLatest = a.statusHistory[a.statusHistory.length - 1]?.updatedAt ?? a.startedAt;
    const bLatest = b.statusHistory[b.statusHistory.length - 1]?.updatedAt ?? b.startedAt;
    return bLatest.localeCompare(aLatest);
  });
}

export function listApplicationsByStatus(): Record<ApplicationStatus, GrantApplication[]> {
  const all = listApplications();
  const grouped: Record<ApplicationStatus, GrantApplication[]> = {
    'preparing': [],
    'submitted': [],
    'under-review': [],
    'approved': [],
    'declined': [],
    'withdrawn': [],
  };
  for (const app of all) {
    grouped[app.status].push(app);
  }
  return grouped;
}
