'use client';

import { useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ClipboardList, Star, Trash2, ExternalLink, CalendarDays, Building2,
  ChevronDown, ChevronUp, DollarSign, FileText,
  ShieldCheck, Users, Info, MessageSquare, Link2,
  CheckCircle2, Circle, TrendingUp, TrendingDown, Minus,
  Send, Clock, XCircle, MinusCircle, Pencil, RotateCcw, Loader2,
} from 'lucide-react';
import {
  useApplicationsByStatus, updateApplicationStatus,
  updateApplicationNotes, updateApplicationAmounts, removeApplication,
} from '@/lib/application-storage';
import { useDeepSearchBatch } from '@/lib/deep-search-storage';
import { GrantApplication, ApplicationStatus, DeepSearchResult, DeepSearchScoreChange } from '@/lib/types';
import { scoreColor, scoreTextClass, formatAmountRange, formatDate, formatDeadline, getDeadlineStatus, deadlineStatusLabel } from '@/lib/formatting';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import ApplicationChecklist from '@/components/application-checklist';
import { useChecklistProgress } from '@/lib/checklist-storage';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateShort(d?: string) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
  } catch { return d; }
}

// ─── Status config ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ApplicationStatus, {
  label: string;
  colors: string;
  border: string;
  pillBg: string;
  icon: React.ElementType;
}> = {
  'preparing':    { label: 'Preparing',    colors: 'bg-amber-50 text-amber-700 ring-amber-200',       border: 'border-l-amber-500',    pillBg: 'bg-amber-100 text-amber-700',     icon: Pencil },
  'submitted':    { label: 'Submitted',    colors: 'bg-blue-50 text-blue-700 ring-blue-200',          border: 'border-l-blue-500',     pillBg: 'bg-blue-100 text-blue-700',       icon: Send },
  'under-review': { label: 'Under Review', colors: 'bg-violet-50 text-violet-700 ring-violet-200',    border: 'border-l-violet-500',   pillBg: 'bg-violet-100 text-violet-700',   icon: Clock },
  'approved':     { label: 'Approved',     colors: 'bg-emerald-50 text-emerald-700 ring-emerald-200', border: 'border-l-emerald-500',  pillBg: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  'declined':     { label: 'Declined',     colors: 'bg-red-50 text-red-700 ring-red-200',             border: 'border-l-red-400',      pillBg: 'bg-red-100 text-red-700',         icon: XCircle },
  'withdrawn':    { label: 'Withdrawn',    colors: 'bg-zinc-100 text-zinc-600 ring-zinc-200',         border: 'border-l-zinc-400',     pillBg: 'bg-zinc-200 text-zinc-600',       icon: MinusCircle },
};

const STATUS_ORDER: ApplicationStatus[] = [
  'preparing', 'submitted', 'under-review', 'approved', 'declined', 'withdrawn',
];

// Shared grid template for desktop header + card rows
const GRID_COLS = 'minmax(0, 2fr) 56px minmax(0, 1fr) 110px 110px 80px 52px 32px';

const STATUS_TRANSITIONS: Record<ApplicationStatus, { status: ApplicationStatus; label: string; primary?: boolean }[]> = {
  'preparing':    [{ status: 'submitted', label: 'Mark as Submitted', primary: true }, { status: 'withdrawn', label: 'Withdraw' }],
  'submitted':    [{ status: 'under-review', label: 'Mark as Under Review', primary: true }, { status: 'withdrawn', label: 'Withdraw' }],
  'under-review': [{ status: 'approved', label: 'Mark as Approved', primary: true }, { status: 'declined', label: 'Mark as Declined' }, { status: 'withdrawn', label: 'Withdraw' }],
  'approved':     [],
  'declined':     [{ status: 'preparing', label: 'Re-open as Preparing' }],
  'withdrawn':    [{ status: 'preparing', label: 'Re-open as Preparing' }],
};

// ─── Score change row ───────────────────────────────────────────────────────

function ScoreChangeRow({ label, change }: { label: string; change: DeepSearchScoreChange }) {
  const delta = change.new - change.old;
  const deltaColor = delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-500' : 'text-zinc-400';
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;

  return (
    <div className="py-2.5 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500">{change.old.toFixed(1)}</span>
          <span className="text-zinc-300 dark:text-zinc-600">&rarr;</span>
          <span className={`text-xs font-bold tabular-nums px-1.5 py-0.5 rounded-md ${scoreTextClass(change.new)}`}>
            {change.new.toFixed(1)}
          </span>
          <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${deltaColor}`}>
            <DeltaIcon className="w-3 h-3" />
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}
          </span>
        </div>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">{change.reason}</p>
    </div>
  );
}

// ─── Section wrapper ────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4 mt-4 first:border-0 first:pt-0 first:mt-0">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-3.5 h-3.5 text-teal-600" />
        <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">{title}</h4>
      </div>
      {children}
    </div>
  );
}

// ─── Status timeline ────────────────────────────────────────────────────────

function StatusTimeline({ history }: { history: GrantApplication['statusHistory'] }) {
  const reversed = [...history].reverse();

  return (
    <div className="relative pl-5">
      <div className="absolute left-[7px] top-1 bottom-1 w-px bg-zinc-200 dark:bg-zinc-700" />
      <div className="space-y-4">
        {reversed.map((entry, i) => {
          const cfg = STATUS_CONFIG[entry.status];
          const Icon = cfg.icon;
          return (
            <div key={i} className="relative">
              <div className={`absolute -left-5 top-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-white dark:ring-zinc-900 flex items-center justify-center ${
                i === 0 ? 'bg-teal-500' : 'bg-zinc-300 dark:bg-zinc-600'
              }`}>
                <Icon className="w-2 h-2 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{cfg.label}</span>
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                    {formatDate(entry.updatedAt)}
                  </span>
                </div>
                {entry.note && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">&ldquo;{entry.note}&rdquo;</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Application card ───────────────────────────────────────────────────────

function ApplicationCard({
  app,
  deep,
}: {
  app: GrantApplication;
  deep: DeepSearchResult | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showGrantDetails, setShowGrantDetails] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<ApplicationStatus | null>(null);
  const [transitionNote, setTransitionNote] = useState('');
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const { grant } = app;
  const cfg = STATUS_CONFIG[app.status];
  const transitions = STATUS_TRANSITIONS[app.status];

  const amount = formatAmountRange(deep?.amountMin ?? grant.amountMin, deep?.amountMax ?? grant.amountMax);
  const rawDeadline = deep?.applicationCloseDate ?? grant.deadline;
  const deadline = formatDeadline(rawDeadline);
  const openDate = formatDate(deep?.applicationOpenDate);
  const score = deep?.scores?.overall ?? grant.scores?.overall ?? 0;
  const dlStatus = getDeadlineStatus(rawDeadline, grant.isRecurring);
  const dlBadge = deadlineStatusLabel(rawDeadline, grant.isRecurring, grant.roundFrequency);
  const checklistProgress = useChecklistProgress(app.grantId);

  async function handleConfirmTransition() {
    if (!pendingTransition) return;
    await updateApplicationStatus(app.grantId, pendingTransition, transitionNote);
    setPendingTransition(null);
    setTransitionNote('');
  }

  async function handleNotesBlur() {
    const value = notesRef.current?.value ?? '';
    if (value !== app.notes) {
      await updateApplicationNotes(app.grantId, value);
    }
  }

  async function handleAmountRequested(value: string) {
    const num = parseFloat(value) || undefined;
    await updateApplicationAmounts(app.grantId, num, app.amountAwarded);
  }

  async function handleAmountAwarded(value: string) {
    const num = parseFloat(value) || undefined;
    await updateApplicationAmounts(app.grantId, app.amountRequested, num);
  }

  async function handleRemove() {
    if (!confirm('Remove this application? This cannot be undone.')) return;
    await removeApplication(app.grantId);
  }

  return (
    <div className={`bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-sm overflow-hidden border-l-4 ${cfg.border}`}>
      {/* ─── Collapsed: Desktop grid row ─── */}
      <div
        className="w-full text-left hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors hidden lg:grid cursor-pointer"
        style={{ gridTemplateColumns: GRID_COLS }}
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3 px-4 py-3 min-w-0 overflow-hidden">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ring-1 flex-shrink-0 ${cfg.colors}`}>
            <cfg.icon className="w-2.5 h-2.5" />
            {cfg.label}
          </span>
          <Tooltip>
            <TooltipTrigger className="truncate font-semibold text-zinc-900 dark:text-zinc-100 text-sm">
              {grant.name}
            </TooltipTrigger>
            <TooltipContent side="bottom">{grant.name}</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center justify-center py-3">
          {checklistProgress ? (
            <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${
              checklistProgress.checked === checklistProgress.total ? 'text-emerald-600' : 'text-amber-600'
            }`}>
              <ClipboardList className="w-2.5 h-2.5" />
              {checklistProgress.checked}/{checklistProgress.total}
            </span>
          ) : (
            <span className="text-zinc-300 dark:text-zinc-600">—</span>
          )}
        </div>
        <div className="flex items-center px-2 py-3 min-w-0 overflow-hidden">
          <Tooltip>
            <TooltipTrigger className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400 truncate">
              <Building2 className="w-3 h-3 text-zinc-400 dark:text-zinc-500 flex-shrink-0" />
              {grant.funder}
            </TooltipTrigger>
            <TooltipContent side="bottom">{grant.funder}</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center px-2 py-3">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 tabular-nums">{amount || '—'}</span>
        </div>
        <div className="flex items-center px-2 py-3">
          <span className="text-sm text-zinc-600 dark:text-zinc-400 tabular-nums">{deadline || 'Open'}</span>
        </div>
        <div className="flex items-center px-2 py-3">
          <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">{formatDateShort(app.startedAt)}</span>
        </div>
        <div className="flex items-center justify-center py-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs text-white tabular-nums"
            style={{ backgroundColor: scoreColor(score) }}
          >
            {score.toFixed(1)}
          </div>
        </div>
        <div className="flex items-center justify-center py-3 text-zinc-400 dark:text-zinc-500">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {/* ─── Collapsed: Mobile stacked card ─── */}
      <button
        className="w-full text-left hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors lg:hidden px-4 py-4"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ring-1 flex-shrink-0 ${cfg.colors}`}>
                <cfg.icon className="w-2.5 h-2.5" />
                {cfg.label}
              </span>
              {checklistProgress && (
                <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${
                  checklistProgress.checked === checklistProgress.total ? 'text-emerald-600' : 'text-amber-600'
                }`}>
                  <ClipboardList className="w-2.5 h-2.5" />
                  {checklistProgress.checked}/{checklistProgress.total}
                </span>
              )}
            </div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm leading-snug mb-1">{grant.name}</h3>
            <p className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 mb-2">
              <Building2 className="w-3 h-3" />
              {grant.funder}
            </p>
            <div className="flex items-center gap-3 flex-wrap text-xs text-zinc-500 dark:text-zinc-400">
              {amount && <span className="font-medium text-zinc-700 dark:text-zinc-300">{amount}</span>}
              {deadline && (
                <span className="flex items-center gap-1">
                  <CalendarDays className={`w-3 h-3 ${dlStatus === 'closing-soon' ? 'text-amber-500' : dlStatus === 'passed' ? 'text-red-400' : 'text-zinc-400'}`} />
                  {deadline}
                  {dlBadge && (
                    <span className={`ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      dlStatus === 'closing-soon' ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                      : dlStatus === 'passed' ? 'bg-red-50 text-red-600 ring-1 ring-red-200'
                      : ''
                    }`}>
                      {dlBadge}
                    </span>
                  )}
                </span>
              )}
              <span className="text-zinc-400 dark:text-zinc-500">Started {formatDateShort(app.startedAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm text-white tabular-nums"
              style={{ backgroundColor: scoreColor(score) }}
            >
              {score.toFixed(1)}
            </div>
            <div className="text-zinc-400 dark:text-zinc-500">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </div>
      </button>

      {/* ─── Expanded detail: two-column layout ─── */}
      {expanded && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 px-5 py-5 bg-zinc-50/50 dark:bg-zinc-800/30">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

            {/* ─── Left column: Actions ─── */}
            <div>
              {/* Status update */}
              {transitions.length > 0 && (
                <Section title="Update Status" icon={RotateCcw}>
                  {pendingTransition === null ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      {transitions.map(t => (
                        <button
                          key={t.status}
                          onClick={() => setPendingTransition(t.status)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                            t.primary
                              ? 'bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white shadow-sm'
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
                        Change status to <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ring-1 ${STATUS_CONFIG[pendingTransition].colors}`}>{STATUS_CONFIG[pendingTransition].label}</span>
                      </p>
                      <textarea
                        value={transitionNote}
                        onChange={e => setTransitionNote(e.target.value)}
                        placeholder="Add a note about this change (optional)..."
                        className="w-full text-sm border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none"
                        rows={2}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleConfirmTransition}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white shadow-sm transition-all"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => { setPendingTransition(null); setTransitionNote(''); }}
                          className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </Section>
              )}

              {/* Application checklist */}
              <Section title="Application Checklist" icon={ClipboardList}>
                <ApplicationChecklist grantId={app.grantId} hasDeepSearch={!!deep} />
              </Section>

              {/* Financial tracking */}
              <Section title="Financial Tracking" icon={DollarSign}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium uppercase block mb-1">Amount Requested ($)</label>
                    <input
                      type="number"
                      defaultValue={app.amountRequested || ''}
                      onBlur={e => handleAmountRequested(e.target.value)}
                      placeholder="e.g. 25000"
                      className="w-full text-sm border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    />
                  </div>
                  {app.status === 'approved' && (
                    <div>
                      <label className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium uppercase block mb-1">Amount Awarded ($)</label>
                      <input
                        type="number"
                        defaultValue={app.amountAwarded || ''}
                        onBlur={e => handleAmountAwarded(e.target.value)}
                        placeholder="e.g. 20000"
                        className="w-full text-sm border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                      />
                    </div>
                  )}
                </div>
              </Section>

              {/* Notes */}
              <Section title="Notes" icon={Pencil}>
                <textarea
                  ref={notesRef}
                  defaultValue={app.notes}
                  onBlur={handleNotesBlur}
                  placeholder="Working notes — to-dos, draft ideas, contact names..."
                  className="w-full text-sm border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none min-h-[80px]"
                  rows={3}
                />
              </Section>

              {/* Actions footer */}
              <div className="flex items-center gap-3 mt-5 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <a
                  href={grant.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                  onClick={e => e.stopPropagation()}
                >
                  View grant page
                  <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  onClick={handleRemove}
                  className="inline-flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500 hover:text-red-500 transition-colors ml-auto"
                >
                  <Trash2 className="w-3 h-3" />
                  Remove Application
                </button>
              </div>
            </div>

            {/* ─── Right column: Reference ─── */}
            <div>
              {/* Key dates */}
              <Section title="Key Dates" icon={CalendarDays}>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2.5">
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium uppercase mb-0.5">Started</p>
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 tabular-nums">{formatDate(app.startedAt) || '—'}</p>
                  </div>
                  <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2.5">
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium uppercase mb-0.5">Submitted</p>
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 tabular-nums">{formatDate(app.submittedAt) || '—'}</p>
                  </div>
                  <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2.5">
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium uppercase mb-0.5">Decided</p>
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 tabular-nums">{formatDate(app.decidedAt) || '—'}</p>
                  </div>
                </div>
              </Section>

              {/* Status timeline */}
              <Section title="Status History" icon={Clock}>
                <StatusTimeline history={app.statusHistory} />
              </Section>

              {/* Grant details (collapsible) */}
              <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4 mt-4">
                <button
                  onClick={() => setShowGrantDetails(d => !d)}
                  className="flex items-center gap-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                >
                  <Info className="w-3.5 h-3.5 text-teal-600" />
                  <span className="uppercase tracking-wider">Grant Details</span>
                  {showGrantDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {showGrantDetails && (
                  <div className="mt-4 space-y-0">
                    {deep && (
                      <Section title="Key Details" icon={Info}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="flex items-start gap-3">
                            <div className="w-7 h-7 rounded-lg bg-teal-50 dark:bg-teal-950 flex items-center justify-center flex-shrink-0">
                              <DollarSign className="w-3.5 h-3.5 text-teal-600" />
                            </div>
                            <div>
                              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium uppercase">Grant Amount</p>
                              <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{amount || 'Not specified'}</p>
                              {deep.amountNotes && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{deep.amountNotes}</p>}
                            </div>
                          </div>

                          <div className="flex items-start gap-3">
                            <div className="w-7 h-7 rounded-lg bg-teal-50 dark:bg-teal-950 flex items-center justify-center flex-shrink-0">
                              <CalendarDays className="w-3.5 h-3.5 text-teal-600" />
                            </div>
                            <div>
                              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium uppercase">Application Window</p>
                              {(openDate || deadline) ? (
                                <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                  {openDate && <span>Opens {openDate}</span>}
                                  {openDate && deadline && <span className="text-zinc-300 dark:text-zinc-600 mx-1">|</span>}
                                  {deadline && <span>Closes {deadline}</span>}
                                </div>
                              ) : (
                                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Open / Rolling</p>
                              )}
                              {deep.dateNotes && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{deep.dateNotes}</p>}
                            </div>
                          </div>

                          <div className="flex items-start gap-3">
                            <div className="w-7 h-7 rounded-lg bg-teal-50 dark:bg-teal-950 flex items-center justify-center flex-shrink-0">
                              <FileText className="w-3.5 h-3.5 text-teal-600" />
                            </div>
                            <div>
                              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium uppercase">Application Form</p>
                              {deep.applicationFormUrl ? (
                                <a
                                  href={deep.applicationFormUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                                  onClick={e => e.stopPropagation()}
                                >
                                  {deep.applicationFormType === 'pdf' ? 'Download PDF' :
                                   deep.applicationFormType === 'word' ? 'Download Word doc' :
                                   deep.applicationFormType === 'online' ? 'Apply online' : 'Application form'}
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Not found</p>
                              )}
                              {deep.applicationFormNotes && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{deep.applicationFormNotes}</p>}
                            </div>
                          </div>

                          {deep.keyContacts && (
                            <div className="flex items-start gap-3">
                              <div className="w-7 h-7 rounded-lg bg-teal-50 dark:bg-teal-950 flex items-center justify-center flex-shrink-0">
                                <MessageSquare className="w-3.5 h-3.5 text-teal-600" />
                              </div>
                              <div>
                                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium uppercase">Contact</p>
                                <p className="text-sm text-zinc-800 dark:text-zinc-200">{deep.keyContacts}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </Section>
                    )}

                    {deep && (
                      <Section title="Score Recalibration" icon={ShieldCheck}>
                        <ScoreChangeRow label="Alignment" change={deep.scoreChanges.alignment} />
                        <ScoreChangeRow label="Ease" change={deep.scoreChanges.ease} />
                        <ScoreChangeRow label="Attainability" change={deep.scoreChanges.attainability} />
                      </Section>
                    )}

                    {deep && deep.eligibilityCriteria.length > 0 && (
                      <Section title="Eligibility Criteria" icon={ShieldCheck}>
                        <ul className="space-y-1.5">
                          {deep.eligibilityCriteria.map((criterion, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                              <span className="text-sm text-zinc-700 dark:text-zinc-300">{criterion}</span>
                            </li>
                          ))}
                        </ul>
                      </Section>
                    )}

                    {deep?.pastRecipientNotes && (
                      <Section title="Past Recipients & Insights" icon={Users}>
                        <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{deep.pastRecipientNotes}</p>
                      </Section>
                    )}

                    {deep?.additionalInfo && (
                      <Section title="Additional Information" icon={Info}>
                        <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{deep.additionalInfo}</p>
                      </Section>
                    )}

                    {grant.alignmentReason && (
                      <Section title="Why It Fits" icon={Star}>
                        <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{grant.alignmentReason}</p>
                      </Section>
                    )}

                    {deep && deep.sourcesUsed.length > 0 && (
                      <Section title="Sources" icon={Link2}>
                        <ul className="space-y-1.5">
                          {deep.sourcesUsed.map((source, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <ExternalLink className="w-3 h-3 text-zinc-400 dark:text-zinc-500 mt-0.5 flex-shrink-0" />
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium break-all"
                                onClick={e => e.stopPropagation()}
                              >
                                {source.title || source.url}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </Section>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

const EMPTY_GROUPED: Record<ApplicationStatus, GrantApplication[]> = {
  'preparing': [], 'submitted': [], 'under-review': [], 'approved': [], 'declined': [], 'withdrawn': [],
};

export default function ApplicationsPage() {
  const router = useRouter();
  const { data: grouped = EMPTY_GROUPED, isLoading } = useApplicationsByStatus();

  const allIds = useMemo(
    () => Object.values(grouped).flatMap(apps => apps.map(a => a.grantId)),
    [grouped],
  );
  const { data: deepSearchMap = new Map() } = useDeepSearchBatch(allIds);

  const totalApps = Object.values(grouped).reduce((sum, apps) => sum + apps.length, 0);

  // Counts per status for summary pills
  const statusCounts = useMemo(() => {
    const counts: Partial<Record<ApplicationStatus, number>> = {};
    for (const status of STATUS_ORDER) {
      const count = grouped[status].length;
      if (count > 0) counts[status] = count;
    }
    return counts;
  }, [grouped]);

  function scrollToStatus(status: ApplicationStatus) {
    document.getElementById(`status-${status}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f7f5f0] dark:bg-zinc-900 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f5f0] dark:bg-zinc-900">
      <div className="max-w-6xl mx-auto px-6 py-12">

        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 bg-teal-50 dark:bg-teal-950 rounded-xl flex items-center justify-center">
            <ClipboardList className="w-4 h-4 text-teal-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Applications</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {totalApps === 0
                ? 'No applications yet'
                : `${totalApps} application${totalApps === 1 ? '' : 's'}`
              }
            </p>
          </div>
        </div>

        {/* Status summary pills */}
        {totalApps > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-8">
            {(Object.entries(statusCounts) as [ApplicationStatus, number][]).map(([status, count]) => {
              const cfg = STATUS_CONFIG[status];
              const Icon = cfg.icon;
              return (
                <button
                  key={status}
                  onClick={() => scrollToStatus(status)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors hover:opacity-80 ${cfg.pillBg}`}
                >
                  <Icon className="w-3 h-3" />
                  {count} {cfg.label}
                </button>
              );
            })}
          </div>
        )}

        {totalApps === 0 ? (
          <div className="bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 py-20 text-center shadow-sm">
            <ClipboardList className="w-8 h-8 mx-auto mb-3 text-zinc-200 dark:text-zinc-700" />
            <p className="font-semibold text-zinc-400 dark:text-zinc-500 text-sm">No applications yet</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 mb-6">
              Go to your <strong>Shortlisted</strong> grants and click <strong>Start Application</strong> to begin tracking.
            </p>
            <button
              onClick={() => router.push('/shortlisted')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <Star className="w-3.5 h-3.5" />
              View Shortlisted
            </button>
          </div>
        ) : (
          <div className="space-y-10">
            {STATUS_ORDER.map(status => {
              const apps = grouped[status];
              if (apps.length === 0) return null;
              const statusCfg = STATUS_CONFIG[status];
              const StatusIcon = statusCfg.icon;

              return (
                <div key={status} id={`status-${status}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <StatusIcon className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                    <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-200">{statusCfg.label}</h2>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                      {apps.length}
                    </span>
                  </div>

                  {/* Column headers — desktop only */}
                  <div
                    className="hidden lg:grid items-center py-2 text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-medium sticky top-0 bg-[#f7f5f0] dark:bg-zinc-800 z-10 border-b border-zinc-200 dark:border-zinc-700 rounded-t-lg"
                    style={{ gridTemplateColumns: GRID_COLS }}
                  >
                    <span className="px-4">Grant</span>
                    <span className="text-center">
                      <ClipboardList className="w-3 h-3 mx-auto" />
                    </span>
                    <span className="px-2">Funder</span>
                    <span className="px-2">Amount</span>
                    <span className="px-2">Deadline</span>
                    <span className="px-2">Started</span>
                    <span className="text-center">Score</span>
                    <span />
                  </div>

                  <div className="space-y-2">
                    {apps.map(app => (
                      <ApplicationCard
                        key={app.id}
                        app={app}
                        deep={deepSearchMap.get(app.grantId) ?? null}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
