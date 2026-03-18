'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Star, Trash2, ExternalLink, CalendarDays, Building2, Search,
  ChevronDown, ChevronUp, DollarSign, FileText, ClipboardList,
  ShieldCheck, Users, Info, MessageSquare, Link2,
  CheckCircle2, Circle, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import { listShortlistedBySearch, removeFromShortlist, ShortlistedGrant } from '@/lib/shortlist-storage';
import { getDeepSearch } from '@/lib/deep-search-storage';
import { hasApplication, startApplication } from '@/lib/application-storage';
import { GrantOpportunity, DeepSearchScoreChange } from '@/lib/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreColor(score?: number): string {
  const s = score ?? 0;
  if (s >= 8) return '#10b981';
  if (s >= 6.5) return '#f59e0b';
  if (s >= 5) return '#f97316';
  return '#ef4444';
}

function scoreTextClass(score: number): string {
  if (score >= 8) return 'text-emerald-700 bg-emerald-50';
  if (score >= 6.5) return 'text-amber-700 bg-amber-50';
  if (score >= 5) return 'text-orange-600 bg-orange-50';
  return 'text-red-600 bg-red-50';
}

function formatCurrency(n?: number) {
  if (!n) return '';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
}

function formatAmountRange(min?: number, max?: number) {
  if (!min && !max) return null;
  if (min && max) return `${formatCurrency(min)}–${formatCurrency(max)}`;
  if (max) return `Up to ${formatCurrency(max)}`;
  return `From ${formatCurrency(min)}`;
}

function formatDate(d?: string) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return d; }
}

const TYPE_CONFIG: Record<
  GrantOpportunity['type'],
  { badge: string; border: string }
> = {
  Government:    { badge: 'bg-blue-50 text-blue-700 ring-blue-200',       border: 'border-l-blue-500' },
  Foundation:    { badge: 'bg-violet-50 text-violet-700 ring-violet-200', border: 'border-l-violet-500' },
  Corporate:     { badge: 'bg-orange-50 text-orange-700 ring-orange-200', border: 'border-l-orange-500' },
  Community:     { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', border: 'border-l-emerald-500' },
  International: { badge: 'bg-indigo-50 text-indigo-700 ring-indigo-200', border: 'border-l-indigo-500' },
  Other:         { badge: 'bg-zinc-100 text-zinc-600 ring-zinc-200',      border: 'border-l-zinc-400' },
};

// ─── Score change row ────────────────────────────────────────────────────────

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

// ─── Grant card ──────────────────────────────────────────────────────────────

function GrantCard({
  item,
  onRemove,
  onStartApplication,
}: {
  item: ShortlistedGrant;
  onRemove: () => void;
  onStartApplication: (item: ShortlistedGrant) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { grant } = item;
  const deep = getDeepSearch(grant.id);
  const cfg = TYPE_CONFIG[grant.type] ?? TYPE_CONFIG['Other'];
  const applying = hasApplication(grant.id);

  // Use deep search data if available, fall back to grant data
  const amount = formatAmountRange(deep?.amountMin ?? grant.amountMin, deep?.amountMax ?? grant.amountMax);
  const deadline = formatDate(deep?.applicationCloseDate ?? grant.deadline);
  const openDate = formatDate(deep?.applicationOpenDate);
  const score = deep?.scores?.overall ?? grant.scores?.overall ?? 0;

  return (
    <div className={`bg-white rounded-xl ring-1 ring-zinc-200 shadow-sm overflow-hidden border-l-4 ${cfg.border}`}>
      {/* Collapsed header — always visible */}
      <button
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-zinc-50/50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-semibold text-zinc-900 text-sm leading-snug">{grant.name}</h3>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ring-1 ${cfg.badge}`}>
              {grant.type}
            </span>
            {applying && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-teal-50 text-teal-700 ring-1 ring-teal-200">
                <ClipboardList className="w-3 h-3" />
                Applying
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              <Building2 className="w-3 h-3" />
              {grant.funder}
            </span>
            {amount && (
              <span className="text-xs text-zinc-500">
                <span className="text-zinc-400">Amount:</span> <span className="font-medium">{amount}</span>
              </span>
            )}
            {deadline ? (
              <span className="flex items-center gap-1 text-xs text-zinc-500">
                <CalendarDays className="w-3 h-3 text-zinc-400" />
                <span className="text-zinc-400">Closes:</span> <span className="font-medium">{deadline}</span>
              </span>
            ) : (
              <span className="text-xs text-zinc-400">Open / Rolling</span>
            )}
          </div>
        </div>

        {/* Sub-scores */}
        <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
          {[
            { label: 'Align', score: deep?.scores?.alignment ?? grant.scores?.alignment },
            { label: 'Ease', score: deep?.scores?.ease ?? grant.scores?.ease },
            { label: 'Win', score: deep?.scores?.attainability ?? grant.scores?.attainability },
          ].map(({ label, score: s }) => (
            <div key={label} className="flex flex-col items-center gap-0.5">
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md tabular-nums ${scoreTextClass(s ?? 0)}`}>
                {(s ?? 0).toFixed(1)}
              </span>
              <span className="text-[9px] text-zinc-400 font-medium uppercase tracking-wide">{label}</span>
            </div>
          ))}
        </div>

        {/* Overall score */}
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm text-white tabular-nums flex-shrink-0"
          style={{ backgroundColor: scoreColor(score) }}
        >
          {score.toFixed(1)}
        </div>

        <div className="text-zinc-400 flex-shrink-0">
          {expanded
            ? <ChevronUp className="w-4 h-4" />
            : <ChevronDown className="w-4 h-4" />
          }
        </div>
      </button>

      {/* Expanded detail — deep research data */}
      {expanded && (
        <div className="border-t border-zinc-100 px-5 py-5 bg-zinc-50/50">

          {/* Key details grid */}
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

          {/* Score recalibration */}
          {deep && (
            <Section title="Score Recalibration" icon={ShieldCheck}>
              <ScoreChangeRow label="Alignment" change={deep.scoreChanges.alignment} />
              <ScoreChangeRow label="Ease" change={deep.scoreChanges.ease} />
              <ScoreChangeRow label="Attainability" change={deep.scoreChanges.attainability} />
            </Section>
          )}

          {/* Eligibility */}
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

          {/* Application checklist */}
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

          {/* Past recipients */}
          {deep?.pastRecipientNotes && (
            <Section title="Past Recipients & Insights" icon={Users}>
              <p className="text-sm text-zinc-700 leading-relaxed">{deep.pastRecipientNotes}</p>
            </Section>
          )}

          {/* Additional info */}
          {deep?.additionalInfo && (
            <Section title="Additional Information" icon={Info}>
              <p className="text-sm text-zinc-700 leading-relaxed">{deep.additionalInfo}</p>
            </Section>
          )}

          {/* Why it fits (from original search) */}
          {grant.alignmentReason && (
            <Section title="Why It Fits" icon={Star}>
              <p className="text-sm text-zinc-700 leading-relaxed">{grant.alignmentReason}</p>
            </Section>
          )}

          {/* Sources */}
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

          {/* Actions */}
          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-zinc-200">
            {!applying ? (
              <button
                onClick={() => onStartApplication(item)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white shadow-sm transition-all"
              >
                <ClipboardList className="w-3.5 h-3.5" />
                Start Application
              </button>
            ) : (
              <Link
                href="/applications"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100 transition-colors"
                onClick={e => e.stopPropagation()}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                View Application
              </Link>
            )}
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
              onClick={onRemove}
              className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-red-500 transition-colors ml-auto"
            >
              <Trash2 className="w-3 h-3" />
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ShortlistedPage() {
  const router = useRouter();
  const [grouped, setGrouped] = useState(() => listShortlistedBySearch());
  const [, forceUpdate] = useState(0);

  const totalGrants = Object.values(grouped).reduce((sum, items) => sum + items.length, 0);
  const searchCount = Object.keys(grouped).length;

  function handleRemove(grantId: string) {
    removeFromShortlist(grantId);
    setGrouped(listShortlistedBySearch());
  }

  function handleStartApplication(item: ShortlistedGrant) {
    startApplication(item);
    forceUpdate(n => n + 1); // re-render to show "Applying" badge
  }

  return (
    <div className="min-h-screen bg-[#f7f5f0]">
      <div className="max-w-3xl mx-auto px-6 py-12">

        <div className="flex items-center gap-3 mb-8">
          <div className="w-9 h-9 bg-amber-50 rounded-xl flex items-center justify-center">
            <Star className="w-4 h-4 text-amber-600 fill-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-900">Shortlisted Grants</h1>
            <p className="text-sm text-zinc-500">
              {totalGrants === 0
                ? 'No grants shortlisted yet'
                : `${totalGrants} grant${totalGrants === 1 ? '' : 's'} across ${searchCount} search${searchCount === 1 ? '' : 'es'}`
              }
            </p>
          </div>
        </div>

        {totalGrants === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-200 py-20 text-center shadow-sm">
            <Star className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
            <p className="font-semibold text-zinc-400 text-sm">No grants shortlisted yet</p>
            <p className="text-xs text-zinc-400 mt-1 mb-6">
              Open a funding search and click <strong>Shortlist</strong> on any grant to add it here.
            </p>
            <button
              onClick={() => router.push('/saved')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
              Go to searches
            </button>
          </div>
        ) : (
          <div className="space-y-10">
            {Object.entries(grouped).map(([searchTitle, items]) => (
              <div key={searchTitle}>
                <div className="flex items-center gap-2 mb-4">
                  <h2 className="text-base font-bold text-zinc-800">{searchTitle}</h2>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500">
                    {items.length} grant{items.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="space-y-3">
                  {items.map(item => (
                    <GrantCard
                      key={item.grant.id}
                      item={item}
                      onRemove={() => handleRemove(item.grant.id)}
                      onStartApplication={handleStartApplication}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
