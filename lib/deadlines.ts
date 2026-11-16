import type { DeepSearchResult, GrantApplication } from './types';
import { daysUntil } from './formatting';

/** The deadline that matters for an application: the deep-research date first. */
export function applicationDeadline(
  app: GrantApplication,
  deep: DeepSearchResult | null | undefined,
): string | undefined {
  return deep?.applicationCloseDate ?? app.grant.deadline;
}

export interface WatchedDeadline {
  app: GrantApplication;
  deadline: string;
  /** Whole days until the deadline; negative once it has passed. */
  days: number;
}

/**
 * Applications still being prepared whose deadline is close (next 60 days) or
 * recently missed (last 90). A passed deadline on an application that has not
 * been submitted needs a decision, so it is listed rather than hidden.
 */
export function deadlinesToWatch(
  preparing: GrantApplication[],
  deepSearches: Map<string, DeepSearchResult> | undefined,
  limit = 6,
): WatchedDeadline[] {
  const list: WatchedDeadline[] = [];
  for (const app of preparing) {
    const deadline = applicationDeadline(app, deepSearches?.get(app.grantId));
    const days = daysUntil(deadline);
    if (deadline && days !== null && days >= -90 && days <= 60) list.push({ app, deadline, days });
  }
  return list.sort((a, b) => a.days - b.days).slice(0, limit);
}

/** "Today", "Tomorrow", "12 days", "Passed 3 days ago". */
export function describeDays(days: number): string {
  if (days < 0) return `Passed ${-days} day${days === -1 ? '' : 's'} ago`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `${days} days`;
}
