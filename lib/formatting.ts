// Shared formatting and scoring helpers used across results, shortlisted, applications, and deep-search pages.

export function scoreColor(score?: number): string {
  const s = score ?? 0;
  if (s >= 8) return '#10b981';
  if (s >= 6.5) return '#f59e0b';
  if (s >= 6) return '#f97316';
  return '#ef4444';
}

export function scoreTextClass(score?: number): string {
  const s = score ?? 0;
  if (s >= 8) return 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950';
  if (s >= 6.5) return 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950';
  if (s >= 6) return 'text-orange-600 bg-orange-50 dark:text-orange-300 dark:bg-orange-950';
  return 'text-red-600 bg-red-50 dark:text-red-300 dark:bg-red-950';
}

/** The four score bands, in one place, for legends and tooltips. */
export const SCORE_BANDS = [
  { range: '8–10', color: '#10b981', label: 'Excellent match' },
  { range: '6.5–8', color: '#f59e0b', label: 'Good match' },
  { range: '6–6.5', color: '#f97316', label: 'Moderate match' },
  { range: '0–6', color: '#ef4444', label: 'Low match' },
] as const;

export function formatCurrency(n?: number): string {
  if (!n) return '';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
}

export function formatAmountRange(min?: number, max?: number): string | null {
  if (!min && !max) return null;
  if (min && max) return `${formatCurrency(min)}–${formatCurrency(max)}`;
  if (max) return `Up to ${formatCurrency(max)}`;
  return `From ${formatCurrency(min)}`;
}

/** Formats a plain date string (ISO or localised). */
export function formatDate(d?: string, locale = 'en-NZ'): string | null {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return d; }
}

/**
 * Formats a grant deadline string.
 * Handles NZ-specific patterns: "rolling", "biannual - typically ...", "annual - typically ..."
 * Falls back to date formatting for ISO date strings.
 */
export function formatDeadline(d?: string, locale = 'en-NZ'): string | null {
  if (!d) return null;
  if (d === 'rolling') return 'Rolling';
  if (d.startsWith('biannual')) return d.replace('biannual', 'Biannual');
  if (d.startsWith('annual')) return d.replace('annual', 'Annual');
  if (d.startsWith('quarterly')) return 'Quarterly';
  return formatDate(d, locale);
}

export type DeadlineStatus = 'open' | 'closing-soon' | 'passed' | 'rolling' | null;

/**
 * Returns the status of a grant deadline relative to today.
 * - 'rolling': no fixed deadline
 * - 'open': deadline is in the future (>7 days)
 * - 'closing-soon': deadline is within 7 days
 * - 'passed': deadline has passed
 * - null: no deadline or not an ISO date
 */
export function getDeadlineStatus(deadline?: string | null): DeadlineStatus {
  if (!deadline) return null;
  if (deadline === 'rolling') return 'rolling';
  if (deadline.startsWith('annual') || deadline.startsWith('biannual') || deadline.startsWith('quarterly')) return 'rolling';

  // Only process ISO date strings
  if (!/^\d{4}-\d{2}-\d{2}/.test(deadline)) return null;

  const diffDays = daysUntil(deadline);
  if (diffDays === null) return null;
  if (diffDays < 0) return 'passed';
  if (diffDays <= 7) return 'closing-soon';
  return 'open';
}

/**
 * Whole days from today (local time) until an ISO date. Negative when past,
 * null when the value is not an ISO date.
 */
export function daysUntil(date?: string | null): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  // Build both dates in local time — `new Date('2026-03-31')` is UTC midnight,
  // which lands on the previous day in timezones behind UTC.
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Returns a user-facing label for a grant's deadline status.
 * Used in shortlist/applications pages to show contextual badges.
 */
export function deadlineStatusLabel(
  deadline?: string | null,
  isRecurring?: boolean | null,
  roundFrequency?: string | null,
): string | null {
  const status = getDeadlineStatus(deadline);
  if (!status || status === 'open' || status === 'rolling') return null;

  if (status === 'closing-soon') return 'Closing soon';

  // status === 'passed'
  if (isRecurring) {
    const freq = roundFrequency || 'annually';
    return `Round closed \u2014 reopens ${freq}`;
  }
  return 'Deadline passed';
}
