// Shared formatting and scoring helpers used across results, shortlisted, applications, and deep-search pages.

export function scoreColor(score?: number): string {
  const s = score ?? 0;
  if (s >= 8) return '#10b981';
  if (s >= 6.5) return '#f59e0b';
  if (s >= 5) return '#f97316';
  return '#ef4444';
}

export function scoreTextClass(score?: number): string {
  const s = score ?? 0;
  if (s >= 8) return 'text-emerald-700 bg-emerald-50';
  if (s >= 6.5) return 'text-amber-700 bg-amber-50';
  if (s >= 5) return 'text-orange-600 bg-orange-50';
  return 'text-red-600 bg-red-50';
}

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
  return formatDate(d, locale);
}
