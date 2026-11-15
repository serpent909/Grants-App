import {
  Pencil, Send, Clock, CheckCircle2, XCircle, MinusCircle, type LucideIcon,
} from 'lucide-react';
import type { ApplicationStatus, GrantOpportunity } from './types';

/**
 * Visual config shared by every page that shows grants or applications.
 * One definition (with dark-mode variants) instead of a copy per page.
 */

export const GRANT_TYPES: GrantOpportunity['type'][] = [
  'Government', 'Foundation', 'Corporate', 'Community', 'International', 'Other',
];

export const TYPE_CONFIG: Record<
  GrantOpportunity['type'],
  { badge: string; border: string; icon: string }
> = {
  Government: {
    badge: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-800',
    border: 'border-l-blue-500',
    icon: 'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-300',
  },
  Foundation: {
    badge: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-800',
    border: 'border-l-violet-500',
    icon: 'bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300',
  },
  Corporate: {
    badge: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:ring-orange-800',
    border: 'border-l-orange-500',
    icon: 'bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-300',
  },
  Community: {
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800',
    border: 'border-l-emerald-500',
    icon: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300',
  },
  International: {
    badge: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-800',
    border: 'border-l-indigo-500',
    icon: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300',
  },
  Other: {
    badge: 'bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-700 dark:text-zinc-300 dark:ring-zinc-600',
    border: 'border-l-zinc-400',
    icon: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300',
  },
};

export function typeConfig(type: string) {
  return TYPE_CONFIG[type as GrantOpportunity['type']] ?? TYPE_CONFIG.Other;
}

// ─── Application statuses ───────────────────────────────────────────────────

export const STATUS_ORDER: ApplicationStatus[] = [
  'preparing', 'submitted', 'under-review', 'approved', 'declined', 'withdrawn',
];

export const STATUS_CONFIG: Record<ApplicationStatus, {
  label: string;
  /** Small ring badge */
  badge: string;
  /** Left border accent on cards */
  border: string;
  /** Filled summary pill */
  pill: string;
  icon: LucideIcon;
}> = {
  'preparing': {
    label: 'Preparing',
    badge: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800',
    border: 'border-l-amber-500',
    pill: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    icon: Pencil,
  },
  'submitted': {
    label: 'Submitted',
    badge: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-800',
    border: 'border-l-blue-500',
    pill: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    icon: Send,
  },
  'under-review': {
    label: 'Under Review',
    badge: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-800',
    border: 'border-l-violet-500',
    pill: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
    icon: Clock,
  },
  'approved': {
    label: 'Approved',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800',
    border: 'border-l-emerald-500',
    pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    icon: CheckCircle2,
  },
  'declined': {
    label: 'Declined',
    badge: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800',
    border: 'border-l-red-400',
    pill: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
    icon: XCircle,
  },
  'withdrawn': {
    label: 'Withdrawn',
    badge: 'bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-700 dark:text-zinc-300 dark:ring-zinc-600',
    border: 'border-l-zinc-400',
    pill: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
    icon: MinusCircle,
  },
};

export const STATUS_TRANSITIONS: Record<ApplicationStatus, { status: ApplicationStatus; label: string; primary?: boolean }[]> = {
  'preparing':    [{ status: 'submitted', label: 'Mark as Submitted', primary: true }, { status: 'withdrawn', label: 'Withdraw' }],
  'submitted':    [{ status: 'under-review', label: 'Mark as Under Review', primary: true }, { status: 'withdrawn', label: 'Withdraw' }],
  'under-review': [{ status: 'approved', label: 'Mark as Approved', primary: true }, { status: 'declined', label: 'Mark as Declined' }, { status: 'withdrawn', label: 'Withdraw' }],
  'approved':     [],
  'declined':     [{ status: 'preparing', label: 'Re-open as Preparing' }],
  'withdrawn':    [{ status: 'preparing', label: 'Re-open as Preparing' }],
};

// ─── Shared class strings ───────────────────────────────────────────────────

/** External / inline text link in the brand colour (readable in both themes). */
export const LINK_CLASS =
  'font-semibold text-teal-700 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 transition-colors';

/** Primary gradient action button (size/padding added by the caller). */
export const PRIMARY_BUTTON_CLASS =
  'bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white shadow-sm transition-all disabled:opacity-50 disabled:pointer-events-none';

/** Standard text input / textarea. */
export const INPUT_CLASS =
  'w-full text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent';
