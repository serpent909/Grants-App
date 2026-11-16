'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ClipboardList, Star, Trash2, ExternalLink, CalendarDays, Building2,
  ChevronDown, DollarSign, Info, Clock, Pencil, RotateCcw, Loader2,
  Download, Trophy, Target, AlarmClock,
} from 'lucide-react';
import {
  useApplicationsByStatus, updateApplicationStatus,
  updateApplicationNotes, updateApplicationAmounts, removeApplication, emptyGrouped,
} from '@/lib/application-storage';
import { useDeepSearchMap } from '@/lib/deep-search-storage';
import { GrantApplication, ApplicationStatus, DeepSearchResult } from '@/lib/types';
import {
  formatAmountRange, formatCurrency, formatDate, formatDeadline,
  getDeadlineStatus, deadlineStatusLabel,
} from '@/lib/formatting';
import {
  STATUS_CONFIG, STATUS_ORDER, STATUS_TRANSITIONS, LINK_CLASS, PRIMARY_BUTTON_CLASS, INPUT_CLASS,
} from '@/lib/grant-ui';
import { errorMessage } from '@/lib/fetcher';
import { downloadCsv } from '@/lib/csv';
import { applicationDeadline, deadlinesToWatch, describeDays, type WatchedDeadline } from '@/lib/deadlines';
import ApplicationChecklist from '@/components/application-checklist';
import { useChecklistProgress } from '@/lib/checklist-storage';
import { PageShell, PageHeader, EmptyState, ListSkeleton, ErrorState } from '@/components/page-shell';
import { ScoreBadge } from '@/components/grant/score';
import DeepSearchDetails, { DetailSection, safeHref } from '@/components/grant/deep-search-details';
import DeadlineBadge from '@/components/grant/deadline-badge';
import ConfirmDialog from '@/components/confirm-dialog';
import { toast } from '@/components/toast';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateShort(d?: string) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
  } catch { return d; }
}

// Shared grid template for desktop header + card rows
const GRID_COLS = 'minmax(0, 2fr) 56px minmax(0, 1fr) 110px 150px 80px 52px 32px';

// ─── Status timeline ────────────────────────────────────────────────────────

function StatusTimeline({ history }: { history: GrantApplication['statusHistory'] }) {
  const reversed = [...(history ?? [])].reverse();

  return (
    <ol className="relative pl-5">
      <div className="absolute left-[7px] top-1 bottom-1 w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden />
      <div className="space-y-4">
        {reversed.map((entry, i) => {
          const cfg = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG.preparing;
          const Icon = cfg.icon;
          return (
            <li key={i} className="relative">
              <div className={`absolute -left-5 top-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-zinc-50 dark:ring-zinc-900 flex items-center justify-center ${
                i === 0 ? 'bg-teal-500' : 'bg-zinc-300 dark:bg-zinc-600'
              }`}>
                <Icon className="w-2 h-2 text-white" aria-hidden />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{cfg.label}</span>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{formatDate(entry.updatedAt)}</span>
              </div>
              {entry.note && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">&ldquo;{entry.note}&rdquo;</p>
              )}
            </li>
          );
        })}
      </div>
    </ol>
  );
}

// ─── Pipeline summary ───────────────────────────────────────────────────────

function StatTile({ icon: Icon, label, value, hint }: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 px-4 py-3.5 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        <Icon className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" aria-hidden />
        {label}
      </div>
      <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-display tabular-nums mt-1">{value}</p>
      {hint && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function PipelineSummary({ apps, upcoming, onJump }: {
  apps: GrantApplication[];
  upcoming: WatchedDeadline[];
  onJump: (grantId: string) => void;
}) {
  const stats = useMemo(() => {
    const open = apps.filter(a => ['preparing', 'submitted', 'under-review'].includes(a.status));
    const approved = apps.filter(a => a.status === 'approved');
    const declined = apps.filter(a => a.status === 'declined');
    const decided = approved.length + declined.length;
    const sum = (list: GrantApplication[], key: 'amountRequested' | 'amountAwarded') =>
      list.reduce((total, a) => total + (Number(a[key]) || 0), 0);
    return {
      openCount: open.length,
      requestedOpen: sum(open, 'amountRequested'),
      awarded: sum(approved, 'amountAwarded'),
      approvedCount: approved.length,
      decided,
      successRate: decided > 0 ? Math.round((approved.length / decided) * 100) : null,
    };
  }, [apps]);

  return (
    <section aria-label="Pipeline summary" className="mb-8 space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          icon={ClipboardList}
          label="In progress"
          value={String(stats.openCount)}
          hint="Preparing, submitted or under review"
        />
        <StatTile
          icon={Target}
          label="Requested"
          value={stats.requestedOpen > 0 ? formatCurrency(stats.requestedOpen) : '—'}
          hint="Across in-progress applications"
        />
        <StatTile
          icon={Trophy}
          label="Awarded"
          value={stats.awarded > 0 ? formatCurrency(stats.awarded) : '—'}
          hint={`${stats.approvedCount} approved`}
        />
        <StatTile
          icon={Star}
          label="Success rate"
          value={stats.successRate === null ? '—' : `${stats.successRate}%`}
          hint={stats.decided > 0 ? `Of ${stats.decided} decided` : 'No decisions yet'}
        />
      </div>

      {upcoming.length > 0 && (
        <div className="bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-sm px-4 py-3.5">
          <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
            <AlarmClock className="w-3.5 h-3.5 text-amber-500" aria-hidden />
            Deadlines to watch
          </h2>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-700">
            {upcoming.map(({ app, deadline, days }) => (
              <li key={app.grantId}>
                <button
                  type="button"
                  onClick={() => onJump(app.grantId)}
                  className="w-full flex items-center justify-between gap-3 py-2 text-left group"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate group-hover:text-teal-700 dark:group-hover:text-teal-400 transition-colors">
                      {app.grant.name}
                    </span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400 truncate">{app.grant.funder}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`block text-sm font-semibold tabular-nums ${
                      days < 0 ? 'text-red-600 dark:text-red-400'
                        : days <= 7 ? 'text-amber-600 dark:text-amber-400'
                        : 'text-zinc-700 dark:text-zinc-300'
                    }`}>
                      {describeDays(days)}
                    </span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">{formatDate(deadline)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ─── Application card ───────────────────────────────────────────────────────

function ApplicationCard({
  app,
  deep,
  onRequestRemove,
}: {
  app: GrantApplication;
  deep: DeepSearchResult | null;
  onRequestRemove: (app: GrantApplication) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showGrantDetails, setShowGrantDetails] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<ApplicationStatus | null>(null);
  const [transitionNote, setTransitionNote] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [notesState, setNotesState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const { grant } = app;
  const cfg = STATUS_CONFIG[app.status];
  const transitions = STATUS_TRANSITIONS[app.status];
  const panelId = `application-panel-${app.grantId}`;

  const amount = formatAmountRange(deep?.amountMin ?? grant.amountMin, deep?.amountMax ?? grant.amountMax);
  const rawDeadline = applicationDeadline(app, deep);
  const deadline = formatDeadline(rawDeadline);
  const score = deep?.scores?.overall ?? grant.scores?.overall ?? 0;
  // Deadline warnings only matter until the application has been sent.
  const dlStatus = app.status === 'preparing' ? getDeadlineStatus(rawDeadline) : null;
  const dlBadge = app.status === 'preparing'
    ? deadlineStatusLabel(rawDeadline, grant.isRecurring, grant.roundFrequency)
    : null;
  const checklistProgress = useChecklistProgress(app.grantId);
  const grantHref = safeHref(grant.url);

  async function handleConfirmTransition() {
    if (!pendingTransition) return;
    setSavingStatus(true);
    try {
      await updateApplicationStatus(app.grantId, pendingTransition, transitionNote.trim());
      toast.success(`Marked as ${STATUS_CONFIG[pendingTransition].label}`);
      setPendingTransition(null);
      setTransitionNote('');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the status.'));
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleNotesBlur(value: string) {
    if (value === app.notes) return;
    setNotesState('saving');
    try {
      await updateApplicationNotes(app.grantId, value);
      setNotesState('saved');
      setTimeout(() => setNotesState('idle'), 2000);
    } catch (err) {
      setNotesState('idle');
      toast.error(errorMessage(err, 'Your notes could not be saved.'));
    }
  }

  async function handleAmountBlur(field: 'amountRequested' | 'amountAwarded', raw: string) {
    const trimmed = raw.trim();
    // Empty clears the value; anything else must be a non-negative number.
    const next = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      toast.error('Enter the amount as a number, e.g. 25000');
      return;
    }
    if ((next ?? undefined) === (app[field] ?? undefined)) return;
    try {
      await updateApplicationAmounts(app.grantId, { [field]: next });
    } catch (err) {
      toast.error(errorMessage(err, 'The amount could not be saved.'));
    }
  }

  const statusBadge = (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ring-1 flex-shrink-0 ${cfg.badge}`}>
      <cfg.icon className="w-2.5 h-2.5" aria-hidden />
      {cfg.label}
    </span>
  );

  const checklistBadge = checklistProgress && (
    <span
      className={`flex items-center gap-0.5 text-[10px] font-semibold ${
        checklistProgress.checked === checklistProgress.total
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-amber-600 dark:text-amber-400'
      }`}
      aria-label={`Checklist ${checklistProgress.checked} of ${checklistProgress.total} complete`}
    >
      <ClipboardList className="w-2.5 h-2.5" aria-hidden />
      {checklistProgress.checked}/{checklistProgress.total}
    </span>
  );

  return (
    <li
      id={`application-${app.grantId}`}
      className={`scroll-mt-24 bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-sm overflow-hidden border-l-4 ${cfg.border}`}
    >
      {/* ─── Collapsed: Desktop grid row ─── */}
      <button
        type="button"
        className="w-full text-left hover:bg-zinc-50/70 dark:hover:bg-zinc-700/30 transition-colors hidden lg:grid"
        style={{ gridTemplateColumns: GRID_COLS }}
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        <span className="flex items-center gap-3 px-4 py-3 min-w-0">
          {statusBadge}
          <span className="truncate font-semibold text-zinc-900 dark:text-zinc-100 text-sm" title={grant.name}>
            {grant.name}
          </span>
        </span>
        <span className="flex items-center justify-center py-3">
          {checklistBadge || <span className="text-zinc-300 dark:text-zinc-600" aria-hidden>—</span>}
        </span>
        <span className="flex items-center gap-1.5 px-2 py-3 min-w-0 text-sm text-zinc-600 dark:text-zinc-400" title={grant.funder}>
          <Building2 className="w-3 h-3 text-zinc-400 dark:text-zinc-500 flex-shrink-0" aria-hidden />
          <span className="truncate">{grant.funder}</span>
        </span>
        <span className="flex items-center px-2 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-300 tabular-nums">
          {amount || '—'}
        </span>
        <span className="flex items-center flex-wrap gap-y-0.5 px-2 py-3 text-sm text-zinc-600 dark:text-zinc-400 tabular-nums">
          {deadline || 'Open'}
          {/* The column is narrow, so the desktop row uses short labels. */}
          <DeadlineBadge
            status={dlStatus}
            label={dlStatus === 'closing-soon' ? 'Soon' : dlStatus === 'passed' ? 'Passed' : null}
          />
        </span>
        <span className="flex items-center px-2 py-3 text-xs text-zinc-500 dark:text-zinc-500 tabular-nums">
          {formatDateShort(app.startedAt)}
        </span>
        <span className="flex items-center justify-center py-3">
          <ScoreBadge score={score} size="sm" />
        </span>
        <span className="flex items-center justify-center py-3 text-zinc-400 dark:text-zinc-500">
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
        </span>
      </button>

      {/* ─── Collapsed: Mobile stacked card ─── */}
      <button
        type="button"
        className="w-full text-left hover:bg-zinc-50/70 dark:hover:bg-zinc-700/30 transition-colors lg:hidden px-4 py-4"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        <span className="flex items-start justify-between gap-3">
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2 mb-1.5">
              {statusBadge}
              {checklistBadge}
            </span>
            <span className="block font-semibold text-zinc-900 dark:text-zinc-100 text-sm leading-snug mb-1">{grant.name}</span>
            <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 mb-2">
              <Building2 className="w-3 h-3" aria-hidden />
              {grant.funder}
            </span>
            <span className="flex items-center gap-3 flex-wrap text-xs text-zinc-500 dark:text-zinc-400">
              {amount && <span className="font-medium text-zinc-700 dark:text-zinc-300">{amount}</span>}
              {deadline && (
                <span className="flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" aria-hidden />
                  {deadline}
                  <DeadlineBadge status={dlStatus} label={dlBadge} />
                </span>
              )}
              <span>Started {formatDateShort(app.startedAt)}</span>
            </span>
          </span>
          <span className="flex items-center gap-2 shrink-0">
            <ScoreBadge score={score} />
            <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
          </span>
        </span>
      </button>

      {/* ─── Expanded detail: two-column layout ─── */}
      {expanded && (
        <div id={panelId} className="border-t border-zinc-100 dark:border-zinc-700 px-5 py-5 bg-zinc-50/60 dark:bg-zinc-900/30">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

            {/* ─── Left column: Actions ─── */}
            <div>
              {transitions.length > 0 && (
                <DetailSection title="Update Status" icon={RotateCcw}>
                  {pendingTransition === null ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      {transitions.map(t => (
                        <button
                          key={t.status}
                          type="button"
                          onClick={() => setPendingTransition(t.status)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                            t.primary
                              ? PRIMARY_BUTTON_CLASS
                              : 'bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-500'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-3">
                      <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Change status to{' '}
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ring-1 ${STATUS_CONFIG[pendingTransition].badge}`}>
                          {STATUS_CONFIG[pendingTransition].label}
                        </span>
                      </p>
                      <textarea
                        value={transitionNote}
                        onChange={e => setTransitionNote(e.target.value)}
                        placeholder="Add a note about this change (optional)…"
                        aria-label="Note about this status change"
                        maxLength={5000}
                        className={`${INPUT_CLASS} resize-none`}
                        rows={2}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleConfirmTransition}
                          disabled={savingStatus}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ${PRIMARY_BUTTON_CLASS}`}
                        >
                          {savingStatus && <Loader2 className="w-3 h-3 animate-spin" aria-hidden />}
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => { setPendingTransition(null); setTransitionNote(''); }}
                          disabled={savingStatus}
                          className="px-2 py-1.5 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </DetailSection>
              )}

              <DetailSection title="Application Checklist" icon={ClipboardList}>
                <ApplicationChecklist grantId={app.grantId} hasDeepSearch={!!deep} />
              </DetailSection>

              <DetailSection title="Financial Tracking" icon={DollarSign}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium uppercase block mb-1">Amount Requested ($)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      key={`requested-${app.amountRequested ?? ''}`}
                      defaultValue={app.amountRequested ?? ''}
                      onBlur={e => handleAmountBlur('amountRequested', e.target.value)}
                      placeholder="e.g. 25000"
                      className={INPUT_CLASS}
                    />
                  </label>
                  {app.status === 'approved' && (
                    <label className="block">
                      <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium uppercase block mb-1">Amount Awarded ($)</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        key={`awarded-${app.amountAwarded ?? ''}`}
                        defaultValue={app.amountAwarded ?? ''}
                        onBlur={e => handleAmountBlur('amountAwarded', e.target.value)}
                        placeholder="e.g. 20000"
                        className={INPUT_CLASS}
                      />
                    </label>
                  )}
                </div>
              </DetailSection>

              <DetailSection title="Notes" icon={Pencil}>
                <textarea
                  defaultValue={app.notes}
                  onBlur={e => handleNotesBlur(e.target.value)}
                  placeholder="Working notes — to-dos, draft ideas, contact names…"
                  aria-label="Application notes"
                  maxLength={20000}
                  className={`${INPUT_CLASS} resize-y min-h-[80px]`}
                  rows={3}
                />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1 h-4" aria-live="polite">
                  {notesState === 'saving' ? 'Saving…' : notesState === 'saved' ? 'Saved' : 'Saved automatically when you click away'}
                </p>
              </DetailSection>

              <div className="flex items-center gap-3 mt-5 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                {grantHref && (
                  <a
                    href={grantHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1.5 text-xs ${LINK_CLASS}`}
                  >
                    View grant page
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => onRequestRemove(app)}
                  className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 transition-colors ml-auto"
                >
                  <Trash2 className="w-3 h-3" aria-hidden />
                  Remove Application
                </button>
              </div>
            </div>

            {/* ─── Right column: Reference ─── */}
            <div>
              <DetailSection title="Key Dates" icon={CalendarDays}>
                <dl className="grid grid-cols-3 gap-3">
                  {[
                    ['Started', app.startedAt],
                    ['Submitted', app.submittedAt],
                    ['Decided', app.decidedAt],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2.5">
                      <dt className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium uppercase mb-0.5">{label}</dt>
                      <dd className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 tabular-nums">{formatDate(value) || '—'}</dd>
                    </div>
                  ))}
                </dl>
              </DetailSection>

              <DetailSection title="Status History" icon={Clock}>
                <StatusTimeline history={app.statusHistory} />
              </DetailSection>

              {/* Grant details (collapsible) */}
              <div className="border-t border-zinc-100 dark:border-zinc-700 pt-4 mt-4">
                <button
                  type="button"
                  onClick={() => setShowGrantDetails(d => !d)}
                  aria-expanded={showGrantDetails}
                  className="flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                >
                  <Info className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" aria-hidden />
                  <span className="uppercase tracking-wider">Grant Details</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${showGrantDetails ? 'rotate-180' : ''}`} aria-hidden />
                </button>

                {showGrantDetails && (
                  <div className="mt-4">
                    {deep ? (
                      <DeepSearchDetails deep={deep} grant={grant} showChecklist={false} />
                    ) : (
                      <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                        {grant.description && <p>{grant.description}</p>}
                        {grant.alignmentReason && (
                          <p><span className="font-semibold">Why it fits: </span>{grant.alignmentReason}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

const EMPTY_GROUPED = emptyGrouped();

export default function ApplicationsPage() {
  const { data: grouped = EMPTY_GROUPED, isLoading, error, mutate } = useApplicationsByStatus();
  const { data: deepSearchMap } = useDeepSearchMap();
  const [removeTarget, setRemoveTarget] = useState<GrantApplication | null>(null);
  const [removing, setRemoving] = useState(false);

  const allApps = useMemo(() => STATUS_ORDER.flatMap(status => grouped[status]), [grouped]);
  const totalApps = allApps.length;

  // Applications still being prepared whose deadline is near, or recently passed.
  const upcoming = useMemo(
    () => deadlinesToWatch(grouped.preparing, deepSearchMap),
    [grouped, deepSearchMap],
  );

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleExport() {
    downloadCsv(
      `grant-applications-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Grant', 'Funder', 'Status', 'Deadline', 'Started', 'Submitted', 'Decided', 'Amount requested', 'Amount awarded', 'Score', 'Search', 'Grant URL', 'Notes'],
      allApps.map(app => {
        const deep = deepSearchMap?.get(app.grantId) ?? null;
        return [
          app.grant.name,
          app.grant.funder,
          STATUS_CONFIG[app.status].label,
          applicationDeadline(app, deep) ?? '',
          app.startedAt?.slice(0, 10),
          app.submittedAt?.slice(0, 10),
          app.decidedAt?.slice(0, 10),
          app.amountRequested,
          app.amountAwarded,
          deep?.scores?.overall ?? app.grant.scores?.overall,
          app.searchTitle,
          app.grant.url,
          app.notes,
        ];
      }),
    );
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await removeApplication(removeTarget.grantId);
      toast.success('Application removed');
      setRemoveTarget(null);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not remove this application.'));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <PageShell>
      <PageHeader
        icon={ClipboardList}
        title="Applications"
        subtitle={
          isLoading ? 'Loading…'
            : totalApps === 0 ? 'No applications yet'
            : `${totalApps} application${totalApps === 1 ? '' : 's'}`
        }
        actions={totalApps > 0 && (
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-white dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700 text-zinc-700 dark:text-zinc-300 hover:ring-zinc-300 dark:hover:ring-zinc-600 transition-all"
          >
            <Download className="w-3.5 h-3.5" aria-hidden />
            Export CSV
          </button>
        )}
      />

      {isLoading ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
      ) : totalApps === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No applications yet"
          action={
            <Link
              href="/shortlisted"
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <Star className="w-3.5 h-3.5" aria-hidden />
              View Shortlisted
            </Link>
          }
        >
          Open a <strong>Shortlisted</strong> grant and choose <strong>Start Application</strong> to track it here.
        </EmptyState>
      ) : (
        <>
          <PipelineSummary
            apps={allApps}
            upcoming={upcoming}
            onJump={grantId => scrollTo(`application-${grantId}`)}
          />

          {/* Status summary pills */}
          <nav aria-label="Jump to status" className="flex items-center gap-2 flex-wrap mb-8">
            {STATUS_ORDER.filter(status => grouped[status].length > 0).map(status => {
              const cfg = STATUS_CONFIG[status];
              const Icon = cfg.icon;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => scrollTo(`status-${status}`)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-opacity hover:opacity-80 ${cfg.pill}`}
                >
                  <Icon className="w-3 h-3" aria-hidden />
                  {grouped[status].length} {cfg.label}
                </button>
              );
            })}
          </nav>

          <div className="space-y-10">
            {STATUS_ORDER.map(status => {
              const apps = grouped[status];
              if (apps.length === 0) return null;
              const statusCfg = STATUS_CONFIG[status];
              const StatusIcon = statusCfg.icon;

              return (
                <section key={status} id={`status-${status}`} className="scroll-mt-24" aria-label={statusCfg.label}>
                  <div className="flex items-center gap-2 mb-3">
                    <StatusIcon className="w-4 h-4 text-zinc-500 dark:text-zinc-400" aria-hidden />
                    <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-200">{statusCfg.label}</h2>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                      {apps.length}
                    </span>
                  </div>

                  {/* Column headers — desktop only */}
                  <div
                    className="hidden lg:grid items-center py-2 text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-500 font-medium border-b border-zinc-200 dark:border-zinc-700 mb-2"
                    style={{ gridTemplateColumns: GRID_COLS }}
                    aria-hidden
                  >
                    <span className="px-4">Grant</span>
                    <span className="flex justify-center" title="Checklist progress">
                      <ClipboardList className="w-3 h-3" />
                    </span>
                    <span className="px-2">Funder</span>
                    <span className="px-2">Amount</span>
                    <span className="px-2">Deadline</span>
                    <span className="px-2">Started</span>
                    <span className="text-center">Score</span>
                    <span />
                  </div>

                  <ul className="space-y-2">
                    {apps.map(app => (
                      <ApplicationCard
                        key={app.id}
                        app={app}
                        deep={deepSearchMap?.get(app.grantId) ?? null}
                        onRequestRemove={setRemoveTarget}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove application?"
        confirmLabel="Remove application"
        tone="danger"
        busy={removing}
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      >
        {removeTarget && (
          <p>
            Your status history and notes for{' '}
            <span className="font-medium text-zinc-800 dark:text-zinc-200">&ldquo;{removeTarget.grant.name}&rdquo;</span>{' '}
            will be deleted. This cannot be undone.
          </p>
        )}
      </ConfirmDialog>
    </PageShell>
  );
}
