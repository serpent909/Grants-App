'use client';

import {
  ExternalLink, CalendarDays, DollarSign, FileText, ShieldCheck, Users, Info,
  MessageSquare, Link2, CheckCircle2, Circle, ClipboardList, Star,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import type { DeepSearchResult, DeepSearchScoreChange, GrantOpportunity } from '@/lib/types';
import { scoreTextClass, formatAmountRange, formatDate, formatDeadline } from '@/lib/formatting';
import { computeOverallScore } from '@/lib/scoring';
import { LINK_CLASS } from '@/lib/grant-ui';

/**
 * Only render links that are plain http(s). Deep-search URLs come from model
 * output; the server already filters them, this is the second line of defence
 * against a `javascript:` (or similar) href reaching the DOM.
 */
export function safeHref(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}

// ─── Building blocks ────────────────────────────────────────────────────────

/**
 * Titled section. `card` renders a bordered card (results page);
 * `flat` renders a divider-separated block (inside expanded cards).
 */
export function DetailSection({ title, icon: Icon, variant = 'flat', children }: {
  title: string;
  icon: React.ElementType;
  variant?: 'card' | 'flat';
  children: React.ReactNode;
}) {
  if (variant === 'card') {
    return (
      <section className="bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/30">
          <Icon className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" aria-hidden />
          <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">{title}</h4>
        </div>
        <div className="px-4 py-3">{children}</div>
      </section>
    );
  }
  return (
    <section className="border-t border-zinc-100 dark:border-zinc-700 pt-4 mt-4 first:border-0 first:pt-0 first:mt-0">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" aria-hidden />
        <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">{title}</h4>
      </div>
      {children}
    </section>
  );
}

export function ScoreChangeRow({ label, change: raw }: { label: string; change?: DeepSearchScoreChange }) {
  // Results saved before model output was validated may hold non-numeric values.
  const change = {
    old: Number(raw?.old) || 0,
    new: Number(raw?.new) || 0,
    reason: typeof raw?.reason === 'string' ? raw.reason : '',
  };
  const delta = change.new - change.old;
  const deltaColor = delta > 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : delta < 0 ? 'text-red-500 dark:text-red-400' : 'text-zinc-400';
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;

  return (
    <div className="py-2.5 border-b border-zinc-100 dark:border-zinc-700 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-sm tabular-nums text-zinc-400 dark:text-zinc-500">{change.old.toFixed(1)}</span>
          <span className="text-zinc-300 dark:text-zinc-600" aria-hidden>&rarr;</span>
          <span className={`text-sm font-bold tabular-nums px-1.5 py-0.5 rounded-md ${scoreTextClass(change.new)}`}>
            {change.new.toFixed(1)}
          </span>
          <span className={`text-xs font-semibold flex items-center gap-0.5 ${deltaColor}`}>
            <DeltaIcon className="w-3 h-3" aria-hidden />
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}
          </span>
        </div>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">{change.reason}</p>
    </div>
  );
}

function KeyDetail({ icon: Icon, label, children }: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-950 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">{label}</p>
        {children}
      </div>
    </div>
  );
}

const VALUE_CLASS = 'text-sm font-semibold text-zinc-800 dark:text-zinc-200';
const NOTE_CLASS = 'text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed';

function formLabel(type?: DeepSearchResult['applicationFormType']): string {
  if (type === 'pdf') return 'Download PDF';
  if (type === 'word') return 'Download Word doc';
  if (type === 'online') return 'Apply online';
  return 'Application form';
}

// ─── Full deep-search report ────────────────────────────────────────────────

interface DeepSearchDetailsProps {
  deep: DeepSearchResult;
  /** Supplies the fallback amount/deadline and the "Why it fits" text. */
  grant?: GrantOpportunity;
  variant?: 'card' | 'flat';
  /** Read-only checklist preview (the applications page has its own interactive one). */
  showChecklist?: boolean;
  showOverallChange?: boolean;
}

/**
 * Everything a deep search found, rendered consistently wherever it appears
 * (search results, shortlist, applications, standalone report).
 */
export default function DeepSearchDetails({
  deep,
  grant,
  variant = 'flat',
  showChecklist = true,
  showOverallChange = false,
}: DeepSearchDetailsProps) {
  const amount = formatAmountRange(deep.amountMin ?? grant?.amountMin, deep.amountMax ?? grant?.amountMax);
  const openDate = formatDate(deep.applicationOpenDate);
  const closeDate = formatDeadline(deep.applicationCloseDate ?? grant?.deadline);
  const formHref = safeHref(deep.applicationFormUrl);
  const changes = deep.scoreChanges ?? {};
  const previousOverall = computeOverallScore({
    alignment: Number(changes.alignment?.old) || 0,
    ease: Number(changes.ease?.old) || 0,
    attainability: Number(changes.attainability?.old) || 0,
  });
  const eligibility = Array.isArray(deep.eligibilityCriteria) ? deep.eligibilityCriteria : [];
  const checklist = Array.isArray(deep.checklist) ? deep.checklist : [];
  const sources = Array.isArray(deep.sourcesUsed) ? deep.sourcesUsed : [];

  return (
    <div className={variant === 'card' ? 'space-y-3' : ''}>
      <DetailSection title="Key Details" icon={Info} variant={variant}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <KeyDetail icon={DollarSign} label="Grant Amount">
            <p className={VALUE_CLASS}>{amount || 'Not specified'}</p>
            {deep.amountNotes && <p className={NOTE_CLASS}>{deep.amountNotes}</p>}
          </KeyDetail>

          <KeyDetail icon={CalendarDays} label="Application Window">
            {openDate || closeDate ? (
              <p className={VALUE_CLASS}>
                {openDate && <span>Opens {openDate}</span>}
                {openDate && closeDate && <span className="text-zinc-300 dark:text-zinc-600 mx-1" aria-hidden>|</span>}
                {closeDate && <span>Closes {closeDate}</span>}
              </p>
            ) : (
              <p className={VALUE_CLASS}>Open / Rolling</p>
            )}
            {deep.dateNotes && <p className={NOTE_CLASS}>{deep.dateNotes}</p>}
          </KeyDetail>

          <KeyDetail icon={FileText} label="Application Form">
            {formHref ? (
              <a
                href={formHref}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 text-sm ${LINK_CLASS}`}
              >
                {formLabel(deep.applicationFormType)}
                <ExternalLink className="w-3 h-3" aria-hidden />
              </a>
            ) : (
              <p className={VALUE_CLASS}>Not found</p>
            )}
            {deep.applicationFormNotes && <p className={NOTE_CLASS}>{deep.applicationFormNotes}</p>}
          </KeyDetail>

          {deep.keyContacts && (
            <KeyDetail icon={MessageSquare} label="Contact">
              <p className="text-sm text-zinc-800 dark:text-zinc-200 break-words">{deep.keyContacts}</p>
            </KeyDetail>
          )}
        </div>
      </DetailSection>

      <DetailSection title="Score Recalibration" icon={ShieldCheck} variant={variant}>
        {showOverallChange && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-zinc-400 dark:text-zinc-500">Overall score:</span>
            <span className="text-sm font-bold tabular-nums text-zinc-400 dark:text-zinc-500">
              {previousOverall.toFixed(1)}
            </span>
            <span className="text-zinc-300 dark:text-zinc-600" aria-hidden>&rarr;</span>
            <span className={`text-sm font-bold tabular-nums px-1.5 py-0.5 rounded-md ${scoreTextClass(deep.scores?.overall)}`}>
              {(deep.scores?.overall ?? 0).toFixed(1)}
            </span>
          </div>
        )}
        <ScoreChangeRow label="Alignment" change={changes.alignment} />
        <ScoreChangeRow label="Ease" change={changes.ease} />
        <ScoreChangeRow label="Attainability" change={changes.attainability} />
      </DetailSection>

      {eligibility.length > 0 && (
        <DetailSection title="Eligibility Criteria" icon={ShieldCheck} variant={variant}>
          <ul className="space-y-2">
            {eligibility.map((criterion, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" aria-hidden />
                <span className="text-sm text-zinc-700 dark:text-zinc-300">{criterion}</span>
              </li>
            ))}
          </ul>
        </DetailSection>
      )}

      {showChecklist && checklist.length > 0 && (
        <DetailSection title="Application Checklist" icon={ClipboardList} variant={variant}>
          <ul className="space-y-3">
            {checklist.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5">
                {item.required ? (
                  <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400 mt-0.5 flex-shrink-0" aria-hidden />
                ) : (
                  <Circle className="w-4 h-4 text-zinc-300 dark:text-zinc-600 mt-0.5 flex-shrink-0" aria-hidden />
                )}
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{item.item}</span>
                    <RequiredTag required={item.required} />
                  </div>
                  {item.description && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">{item.description}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </DetailSection>
      )}

      {deep.pastRecipientNotes && (
        <DetailSection title="Past Recipients & Insights" icon={Users} variant={variant}>
          <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{deep.pastRecipientNotes}</p>
        </DetailSection>
      )}

      {deep.additionalInfo && (
        <DetailSection title="Additional Information" icon={Info} variant={variant}>
          <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{deep.additionalInfo}</p>
        </DetailSection>
      )}

      {grant?.alignmentReason && variant === 'flat' && (
        <DetailSection title="Why It Fits" icon={Star} variant={variant}>
          <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{grant.alignmentReason}</p>
        </DetailSection>
      )}

      {sources.length > 0 && (
        <DetailSection title="Sources" icon={Link2} variant={variant}>
          <ul className="space-y-2">
            {sources.map((source, i) => {
              const href = safeHref(source.url);
              if (!href) return null;
              return (
                <li key={i} className="flex items-start gap-2">
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 mt-0.5 flex-shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-sm break-words ${LINK_CLASS}`}
                    >
                      {source.title || source.url}
                    </a>
                    {source.title && (
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{source.url}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </DetailSection>
      )}
    </div>
  );
}

export function RequiredTag({ required }: { required: boolean }) {
  return required ? (
    <span className="text-[10px] font-semibold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950 px-1.5 py-0.5 rounded">Required</span>
  ) : (
    <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded">Optional</span>
  );
}
