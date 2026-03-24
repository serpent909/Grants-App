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
import { scoreColor, scoreTextClass, formatCurrency, formatAmountRange, formatDate } from '@/lib/formatting';

// ─── Status config ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ApplicationStatus, {
  label: string;
  colors: string;
  border: string;
  icon: React.ElementType;
}> = {
  'preparing':    { label: 'Preparing',    colors: 'bg-amber-50 text-amber-700 ring-amber-200',       border: 'border-l-amber-500',    icon: Pencil },
  'submitted':    { label: 'Submitted',    colors: 'bg-blue-50 text-blue-700 ring-blue-200',          border: 'border-l-blue-500',     icon: Send },
  'under-review': { label: 'Under Review', colors: 'bg-violet-50 text-violet-700 ring-violet-200',    border: 'border-l-violet-500',   icon: Clock },
  'approved':     { label: 'Approved',     colors: 'bg-emerald-50 text-emerald-700 ring-emerald-200', border: 'border-l-emerald-500',  icon: CheckCircle2 },
  'declined':     { label: 'Declined',     colors: 'bg-red-50 text-red-700 ring-red-200',             border: 'border-l-red-400',      icon: XCircle },
  'withdrawn':    { label: 'Withdrawn',    colors: 'bg-zinc-100 text-zinc-600 ring-zinc-200',         border: 'border-l-zinc-400',     icon: MinusCircle },
};

const STATUS_ORDER: ApplicationStatus[] = [
  'preparing', 'submitted', 'under-review', 'approved', 'declined', 'withdrawn',
];

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
    <div className="py-2.5 border-b border-zinc-100 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-zinc-700">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-zinc-400">{change.old.toFixed(1)}</span>
          <span className="text-zinc-300">&rarr;</span>
          <span className={`text-xs font-bold tabular-nums px-1.5 py-0.5 rounded-md ${scoreTextClass(change.new)}`}>
            {change.new.toFixed(1)}
          </span>
          <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${deltaColor}`}>
            <DeltaIcon className="w-3 h-3" />
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}
          </span>
        </div>
      </div>
      <p className="text-xs text-zinc-500 leading-relaxed">{change.reason}</p>
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
    <div className="border-t border-zinc-100 pt-4 mt-4 first:border-0 first:pt-0 first:mt-0">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-3.5 h-3.5 text-teal-600" />
        <h4 className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">{title}</h4>
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
      <div className="absolute left-[7px] top-1 bottom-1 w-px bg-zinc-200" />
      <div className="space-y-4">
        {reversed.map((entry, i) => {
          const cfg = STATUS_CONFIG[entry.status];
          const Icon = cfg.icon;
          return (
            <div key={i} className="relative">
              <div className={`absolute -left-5 top-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-white flex items-center justify-center ${
                i === 0 ? 'bg-teal-500' : 'bg-zinc-300'
              }`}>
                <Icon className="w-2 h-2 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-700">{cfg.label}</span>
                  <span className="text-[10px] text-zinc-400">
                    {formatDate(entry.updatedAt)}
                  </span>
                </div>
                {entry.note && (
                  <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">&ldquo;{entry.note}&rdquo;</p>
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
  const deadline = formatDate(deep?.applicationCloseDate ?? grant.deadline);
  const openDate = formatDate(deep?.applicationOpenDate);
  const score = deep?.scores?.overall ?? grant.scores?.overall ?? 0;

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
    await removeApplication(app.grantId);
  }

  return (
    <div className={`bg-white rounded-xl ring-1 ring-zinc-200 shadow-sm overflow-hidden border-l-4 ${cfg.border}`}>
      {/* Collapsed header */}
      <button
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-zinc-50/50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold ring-1 flex-shrink-0 ${cfg.colors}`}>
          <cfg.icon className="w-3 h-3" />
          {cfg.label}
        </span>

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-zinc-900 text-sm leading-snug">{grant.name}</h3>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              <Building2 className="w-3 h-3" />
              {grant.funder}
            </span>
            {amount && (
              <span className="text-xs text-zinc-500">
                <span className="font-medium">{amount}</span>
              </span>
            )}
            {deadline && (
              <span className="flex items-center gap-1 text-xs text-zinc-500">
                <CalendarDays className="w-3 h-3 text-zinc-400" />
                {deadline}
              </span>
            )}
            <span className="text-[10px] text-zinc-400">
              Started {formatDate(app.startedAt)}
              {app.submittedAt && <> · Submitted {formatDate(app.submittedAt)}</>}
              {app.decidedAt && <> · Decided {formatDate(app.decidedAt)}</>}
            </span>
          </div>
        </div>

        <div
          className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm text-white tabular-nums flex-shrink-0"
          style={{ backgroundColor: scoreColor(score) }}
        >
          {score.toFixed(1)}
        </div>

        <div className="text-zinc-400 flex-shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-zinc-100 px-5 py-5 bg-zinc-50/50">

          {/* Status update section */}
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
                          : 'bg-white border border-zinc-300 text-zinc-700 hover:border-zinc-400'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="bg-white rounded-lg border border-zinc-200 p-3 space-y-3">
                  <p className="text-xs font-medium text-zinc-700">
                    Change status to <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ring-1 ${STATUS_CONFIG[pendingTransition].colors}`}>{STATUS_CONFIG[pendingTransition].label}</span>
                  </p>
                  <textarea
                    value={transitionNote}
                    onChange={e => setTransitionNote(e.target.value)}
                    placeholder="Add a note about this change (optional)..."
                    className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none"
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
                      className="text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* Financial tracking */}
          <Section title="Financial Tracking" icon={DollarSign}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-zinc-400 font-medium uppercase block mb-1">Amount Requested ($)</label>
                <input
                  type="number"
                  defaultValue={app.amountRequested || ''}
                  onBlur={e => handleAmountRequested(e.target.value)}
                  placeholder="e.g. 25000"
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
              {app.status === 'approved' && (
                <div>
                  <label className="text-[10px] text-zinc-400 font-medium uppercase block mb-1">Amount Awarded ($)</label>
                  <input
                    type="number"
                    defaultValue={app.amountAwarded || ''}
                    onBlur={e => handleAmountAwarded(e.target.value)}
                    placeholder="e.g. 20000"
                    className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
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
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none min-h-[80px]"
              rows={3}
            />
          </Section>

          {/* Status timeline */}
          <Section title="Status History" icon={Clock}>
            <StatusTimeline history={app.statusHistory} />
          </Section>

          {/* Grant details (collapsible) */}
          <div className="border-t border-zinc-100 pt-4 mt-4">
            <button
              onClick={() => setShowGrantDetails(d => !d)}
              className="flex items-center gap-2 text-xs font-semibold text-zinc-500 hover:text-zinc-700 transition-colors"
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
                        <div className="w-7 h-7 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
                          <DollarSign className="w-3.5 h-3.5 text-teal-600" />
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-400 font-medium uppercase">Grant Amount</p>
                          <p className="text-sm font-semibold text-zinc-800">{amount || 'Not specified'}</p>
                          {deep.amountNotes && <p className="text-xs text-zinc-500 mt-0.5">{deep.amountNotes}</p>}
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
                          <CalendarDays className="w-3.5 h-3.5 text-teal-600" />
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-400 font-medium uppercase">Application Window</p>
                          {openDate || deadline ? (
                            <div className="text-sm font-semibold text-zinc-800">
                              {openDate && <span>Opens {openDate}</span>}
                              {openDate && deadline && <span className="text-zinc-300 mx-1">|</span>}
                              {deadline && <span>Closes {deadline}</span>}
                            </div>
                          ) : (
                            <p className="text-sm font-semibold text-zinc-800">Open / Rolling</p>
                          )}
                          {deep.dateNotes && <p className="text-xs text-zinc-500 mt-0.5">{deep.dateNotes}</p>}
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-3.5 h-3.5 text-teal-600" />
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-400 font-medium uppercase">Application Form</p>
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
                            <p className="text-sm font-semibold text-zinc-800">Not found</p>
                          )}
                          {deep.applicationFormNotes && <p className="text-xs text-zinc-500 mt-0.5">{deep.applicationFormNotes}</p>}
                        </div>
                      </div>

                      {deep.keyContacts && (
                        <div className="flex items-start gap-3">
                          <div className="w-7 h-7 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
                            <MessageSquare className="w-3.5 h-3.5 text-teal-600" />
                          </div>
                          <div>
                            <p className="text-[10px] text-zinc-400 font-medium uppercase">Contact</p>
                            <p className="text-sm text-zinc-800">{deep.keyContacts}</p>
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
                          <span className="text-sm text-zinc-700">{criterion}</span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                {deep && deep.checklist.length > 0 && (
                  <Section title="Application Checklist" icon={ClipboardList}>
                    <ul className="space-y-2.5">
                      {deep.checklist.map((checkItem, i) => (
                        <li key={i} className="flex items-start gap-2">
                          {checkItem.required ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 mt-0.5 flex-shrink-0" />
                          ) : (
                            <Circle className="w-3.5 h-3.5 text-zinc-300 mt-0.5 flex-shrink-0" />
                          )}
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-zinc-800">{checkItem.item}</span>
                              {checkItem.required ? (
                                <span className="text-[10px] font-semibold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded">Required</span>
                              ) : (
                                <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded">Optional</span>
                              )}
                            </div>
                            <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{checkItem.description}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                {deep?.pastRecipientNotes && (
                  <Section title="Past Recipients & Insights" icon={Users}>
                    <p className="text-sm text-zinc-700 leading-relaxed">{deep.pastRecipientNotes}</p>
                  </Section>
                )}

                {deep?.additionalInfo && (
                  <Section title="Additional Information" icon={Info}>
                    <p className="text-sm text-zinc-700 leading-relaxed">{deep.additionalInfo}</p>
                  </Section>
                )}

                {grant.alignmentReason && (
                  <Section title="Why It Fits" icon={Star}>
                    <p className="text-sm text-zinc-700 leading-relaxed">{grant.alignmentReason}</p>
                  </Section>
                )}

                {deep && deep.sourcesUsed.length > 0 && (
                  <Section title="Sources" icon={Link2}>
                    <ul className="space-y-1.5">
                      {deep.sourcesUsed.map((source, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <ExternalLink className="w-3 h-3 text-zinc-400 mt-0.5 flex-shrink-0" />
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

          {/* Actions */}
          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-zinc-200">
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
              className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-red-500 transition-colors ml-auto"
            >
              <Trash2 className="w-3 h-3" />
              Remove Application
            </button>
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f7f5f0] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f5f0]">
      <div className="max-w-3xl mx-auto px-6 py-12">

        <div className="flex items-center gap-3 mb-8">
          <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center">
            <ClipboardList className="w-4 h-4 text-teal-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-900">Applications</h1>
            <p className="text-sm text-zinc-500">
              {totalApps === 0
                ? 'No applications yet'
                : `${totalApps} application${totalApps === 1 ? '' : 's'}`
              }
            </p>
          </div>
        </div>

        {totalApps === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-200 py-20 text-center shadow-sm">
            <ClipboardList className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
            <p className="font-semibold text-zinc-400 text-sm">No applications yet</p>
            <p className="text-xs text-zinc-400 mt-1 mb-6">
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
                <div key={status}>
                  <div className="flex items-center gap-2 mb-4">
                    <StatusIcon className="w-4 h-4 text-zinc-500" />
                    <h2 className="text-base font-bold text-zinc-800">{statusCfg.label}</h2>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500">
                      {apps.length}
                    </span>
                  </div>
                  <div className="space-y-3">
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
