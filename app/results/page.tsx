'use client';

import { Suspense, useEffect, useRef, useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ArrowUp, ArrowDown, Search, ExternalLink,
  ChevronDown, ChevronUp, CalendarDays, Building2,
  SlidersHorizontal, X, Star, Check,
  Microscope, Loader2, CheckCircle2, RotateCw,
  DollarSign, FileText, Users, Info, MessageSquare, Link2,
  ShieldCheck, ClipboardList, Circle,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import { scoreColor, scoreTextClass, formatCurrency, formatAmountRange, formatDeadline, formatDate } from '@/lib/formatting';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchResult, GrantOpportunity, DeepSearchResult, DeepSearchScoreChange, OrgInfo } from '@/lib/types';
import { getMarket } from '@/lib/markets';
import { getSaved, saveSearch } from '@/lib/saved-searches';
import { saveDeepSearch, batchGetDeepSearch } from '@/lib/deep-search-storage';
import { addToShortlist, removeFromShortlist } from '@/lib/shortlist-storage';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

// ─── Types ────────────────────────────────────────────────────────────────────

type SortField = 'overall' | 'alignment' | 'attainability' | 'ease' | 'deadline';
type SortDir = 'asc' | 'desc';

interface FunderGroup {
  funder: string;
  type: GrantOpportunity['type'];
  grants: GrantOpportunity[];
  bestScore: number;
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<
  GrantOpportunity['type'],
  { badge: string; border: string; icon: string }
> = {
  Government:    { badge: 'bg-blue-50 text-blue-700 ring-blue-200',    border: 'border-l-blue-500',    icon: 'bg-blue-100 text-blue-600' },
  Foundation:    { badge: 'bg-violet-50 text-violet-700 ring-violet-200', border: 'border-l-violet-500', icon: 'bg-violet-100 text-violet-600' },
  Corporate:     { badge: 'bg-orange-50 text-orange-700 ring-orange-200', border: 'border-l-orange-500', icon: 'bg-orange-100 text-orange-600' },
  Community:     { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', border: 'border-l-emerald-500', icon: 'bg-emerald-100 text-emerald-600' },
  International: { badge: 'bg-indigo-50 text-indigo-700 ring-indigo-200',  border: 'border-l-indigo-500', icon: 'bg-indigo-100 text-indigo-600' },
  Other:         { badge: 'bg-zinc-100 text-zinc-600 ring-zinc-200',    border: 'border-l-zinc-400',   icon: 'bg-zinc-100 text-zinc-500' },
};

// ─── Score ring ───────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 52, validated = false }: { score: number; size?: number; validated?: boolean }) {
  const s = score ?? 0;
  const strokeW = 4;
  const r = (size - strokeW * 2) / 2;
  const circ = 2 * Math.PI * r;
  const arc = Math.max(0, Math.min(1, s / 10)) * circ;
  const color = scoreColor(s);

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" className="stroke-zinc-100 dark:stroke-zinc-700" strokeWidth={strokeW}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={strokeW}
          strokeDasharray={`${arc} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-bold text-zinc-800 dark:text-zinc-200 tabular-nums" style={{ fontSize: size < 44 ? 10 : 12 }}>
          {s.toFixed(1)}
        </span>
      </div>
      {validated && (
        <Tooltip>
          <TooltipTrigger className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center ring-2 ring-white dark:ring-zinc-900">
            <CheckCircle2 className="w-2.5 h-2.5 text-white" />
          </TooltipTrigger>
          <TooltipContent>Deep research completed</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// ─── Score pill ───────────────────────────────────────────────────────────────

function ScorePill({ score, label }: { score: number; label: string }) {
  const s = score ?? 0;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md tabular-nums ${scoreTextClass(s)}`}>
        {s.toFixed(1)}
      </span>
      <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-medium uppercase tracking-wide">{label}</span>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Deep search inline components ───────────────────────────────────────────

function DeepSearchSection({ title, icon: Icon, children }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
        <Icon className="w-3.5 h-3.5 text-teal-600" />
        <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">{title}</h4>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function ScoreChangeRow({ label, change }: { label: string; change: DeepSearchScoreChange }) {
  const delta = change.new - change.old;
  const deltaColor = delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-500' : 'text-zinc-400';
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;

  return (
    <div className="py-2.5 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-sm tabular-nums text-zinc-400 dark:text-zinc-500">{change.old.toFixed(1)}</span>
          <span className="text-zinc-300 dark:text-zinc-600">&rarr;</span>
          <span className={`text-sm font-bold tabular-nums px-1.5 py-0.5 rounded-md ${scoreTextClass(change.new)}`}>
            {change.new.toFixed(1)}
          </span>
          <span className={`text-xs font-semibold flex items-center gap-0.5 ${deltaColor}`}>
            <DeltaIcon className="w-3 h-3" />
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}
          </span>
        </div>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">{change.reason}</p>
    </div>
  );
}

// ─── Grant detail panel ───────────────────────────────────────────────────────

function GrantDetail({
  grant,
  locale,
  deepSearchState = 'idle',
  deepSearchData,
  onDeepSearch,
  isShortlisted = false,
  onToggleShortlist,
}: {
  grant: GrantOpportunity;
  locale: string;
  deepSearchState?: 'idle' | 'loading' | 'complete';
  deepSearchData?: DeepSearchResult | null;
  onDeepSearch?: () => void;
  isShortlisted?: boolean;
  onToggleShortlist?: () => void;
}) {
  const [showDeepSearch, setShowDeepSearch] = useState(false);
  const deadline = formatDeadline(grant.deadline, locale);
  const amount = formatAmountRange(grant.amountMin, grant.amountMax);

  // Use deep search data for enhanced display when available
  const ds = deepSearchData;
  const dsAmount = ds ? formatAmountRange(ds.amountMin, ds.amountMax) : null;
  const dsCloseDate = ds ? formatDate(ds.applicationCloseDate) : null;
  const dsOpenDate = ds ? formatDate(ds.applicationOpenDate) : null;

  return (
    <div className="bg-zinc-50 dark:bg-zinc-800 border-t border-zinc-200 dark:border-zinc-700 px-6 py-6">
      {/* Meta row */}
      {(amount || deadline) && (
        <div className="flex flex-wrap gap-4 mb-5">
          {amount && (
            <div className="text-xs">
              <span className="text-zinc-400 dark:text-zinc-500 mr-1.5">Amount</span>
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">{amount}</span>
            </div>
          )}
          {deadline && (
            <div className="text-xs flex items-center gap-1">
              <CalendarDays className="w-3 h-3 text-zinc-400 dark:text-zinc-500" />
              <span className="text-zinc-400 dark:text-zinc-500 mr-1">Closes</span>
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">{deadline}</span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Description */}
        <div>
          <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">About this grant</h4>
          <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{grant.description}</p>
          <a
            href={grant.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-4 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors group"
          >
            {grant.url.includes('google.com/search') ? 'Search for this grant' : 'View grant page'}
            <ExternalLink className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
          </a>

          {/* Deep Search button */}
          <div className="mt-3">
            {deepSearchState === 'idle' && (
              <button
                onClick={(e) => { e.stopPropagation(); onDeepSearch?.(); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white shadow-sm transition-all"
              >
                <Microscope className="w-3.5 h-3.5" />
                Deep Search
              </button>
            )}
            {deepSearchState === 'loading' && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-50 dark:bg-teal-950 text-teal-700 ring-1 ring-teal-200">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Researching...
              </div>
            )}
            {deepSearchState === 'complete' && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowDeepSearch(v => !v); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100 transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {showDeepSearch ? 'Hide Details' : 'Show Details'}
                  {showDeepSearch ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeepSearch?.(); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 ring-1 ring-zinc-200 dark:ring-zinc-700 transition-colors"
                >
                  <RotateCw className="w-3 h-3" />
                  Re-run
                </button>
                {/* Shortlist button */}
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleShortlist?.(); }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                    isShortlisted
                      ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                      : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:border-amber-400 hover:text-amber-700'
                  }`}
                >
                  <Star className={`w-3.5 h-3.5 ${isShortlisted ? 'fill-amber-400' : ''}`} />
                  {isShortlisted ? 'Shortlisted' : 'Shortlist'}
                </button>
                {ds?.searchedAt && (
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    Last run {new Date(ds.searchedAt).toLocaleString(locale, {
                      day: 'numeric', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Shortlist hint when no deep search */}
          {deepSearchState !== 'complete' && (
            <div className="mt-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 dark:text-zinc-500 italic">
                Run Deep Search for more details
              </span>
            </div>
          )}
        </div>

        {/* Alignment + Application */}
        <div className="space-y-5">
          <div>
            <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">Why it fits</h4>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{grant.alignmentReason}</p>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">How to apply</h4>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{grant.applicationNotes}</p>
          </div>
        </div>

        {/* Attainability + Score breakdown */}
        <div className="space-y-5">
          <div>
            <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">Attainability</h4>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{grant.attainabilityNotes}</p>
          </div>

          {(() => {
            const scores = ds?.scores ?? grant.scores;
            return (
              <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">Score breakdown</p>
                <div className="space-y-2.5">
                  {[
                    { label: 'Alignment', score: scores?.alignment ?? 0 },
                    { label: 'Ease', score: scores?.ease ?? 0 },
                    { label: 'Attainability', score: scores?.attainability ?? 0 },
                  ].map(({ label, score }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${score * 10}%`,
                              backgroundColor: scoreColor(score),
                            }}
                          />
                        </div>
                        <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 tabular-nums w-6 text-right">
                          {score.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800">
                    <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Overall</span>
                    <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
                      {(scores?.overall ?? 0).toFixed(1)}
                      <span className="text-xs font-normal text-zinc-400 dark:text-zinc-500">/10</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Inline Deep Search Results ── */}
      {showDeepSearch && ds && (
        <div className="mt-6 space-y-3 border-t border-zinc-200 dark:border-zinc-700 pt-6">
          {/* Key Details */}
          <DeepSearchSection title="Key Details" icon={Info}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-950 flex items-center justify-center flex-shrink-0">
                  <DollarSign className="w-4 h-4 text-teal-600" />
                </div>
                <div>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">Grant Amount</p>
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{dsAmount || 'Not specified'}</p>
                  {ds.amountNotes && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{ds.amountNotes}</p>}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-950 flex items-center justify-center flex-shrink-0">
                  <CalendarDays className="w-4 h-4 text-teal-600" />
                </div>
                <div>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">Application Window</p>
                  {dsOpenDate || dsCloseDate ? (
                    <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                      {dsOpenDate && <span>Opens {dsOpenDate}</span>}
                      {dsOpenDate && dsCloseDate && <span className="text-zinc-300 dark:text-zinc-600 mx-1">|</span>}
                      {dsCloseDate && <span>Closes {dsCloseDate}</span>}
                    </div>
                  ) : (
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Not specified</p>
                  )}
                  {ds.dateNotes && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{ds.dateNotes}</p>}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-950 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4 text-teal-600" />
                </div>
                <div>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">Application Form</p>
                  {ds.applicationFormUrl ? (
                    <a
                      href={ds.applicationFormUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                    >
                      {ds.applicationFormType === 'pdf' ? 'Download PDF' :
                       ds.applicationFormType === 'word' ? 'Download Word doc' :
                       ds.applicationFormType === 'online' ? 'Apply online' : 'Application form'}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Not found</p>
                  )}
                  {ds.applicationFormNotes && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{ds.applicationFormNotes}</p>}
                </div>
              </div>

              {ds.keyContacts && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-950 flex items-center justify-center flex-shrink-0">
                    <MessageSquare className="w-4 h-4 text-teal-600" />
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">Contact</p>
                    <p className="text-sm text-zinc-800 dark:text-zinc-200">{ds.keyContacts}</p>
                  </div>
                </div>
              )}
            </div>
          </DeepSearchSection>

          {/* Score Recalibration */}
          <DeepSearchSection title="Score Recalibration" icon={ShieldCheck}>
            <div className="mb-2">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-zinc-400 dark:text-zinc-500">Overall score:</span>
                <span className="text-sm font-bold tabular-nums text-zinc-400 dark:text-zinc-500">
                  {ds.scoreChanges.alignment.old ? (
                    (ds.scoreChanges.alignment.old * 0.5 + ds.scoreChanges.attainability.old * 0.3 + ds.scoreChanges.ease.old * 0.2).toFixed(1)
                  ) : '?'}
                </span>
                <span className="text-zinc-300 dark:text-zinc-600">&rarr;</span>
                <span className={`text-sm font-bold tabular-nums px-1.5 py-0.5 rounded-md ${scoreTextClass(ds.scores.overall)}`}>
                  {ds.scores.overall.toFixed(1)}
                </span>
              </div>
            </div>
            <ScoreChangeRow label="Alignment" change={ds.scoreChanges.alignment} />
            <ScoreChangeRow label="Ease" change={ds.scoreChanges.ease} />
            <ScoreChangeRow label="Attainability" change={ds.scoreChanges.attainability} />
          </DeepSearchSection>

          {/* Eligibility Criteria */}
          {ds.eligibilityCriteria.length > 0 && (
            <DeepSearchSection title="Eligibility Criteria" icon={ShieldCheck}>
              <ul className="space-y-2">
                {ds.eligibilityCriteria.map((criterion, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">{criterion}</span>
                  </li>
                ))}
              </ul>
            </DeepSearchSection>
          )}

          {/* Application Checklist */}
          {ds.checklist.length > 0 && (
            <DeepSearchSection title="Application Checklist" icon={ClipboardList}>
              <ul className="space-y-3">
                {ds.checklist.map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    {item.required ? (
                      <CheckCircle2 className="w-4 h-4 text-teal-600 mt-0.5 flex-shrink-0" />
                    ) : (
                      <Circle className="w-4 h-4 text-zinc-300 dark:text-zinc-600 mt-0.5 flex-shrink-0" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{item.item}</span>
                        {item.required ? (
                          <span className="text-[10px] font-semibold text-teal-700 bg-teal-50 dark:bg-teal-950 px-1.5 py-0.5 rounded">Required</span>
                        ) : (
                          <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">Optional</span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">{item.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </DeepSearchSection>
          )}

          {/* Past Recipients & Insights */}
          {ds.pastRecipientNotes && (
            <DeepSearchSection title="Past Recipients & Insights" icon={Users}>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{ds.pastRecipientNotes}</p>
            </DeepSearchSection>
          )}

          {/* Additional Information */}
          {ds.additionalInfo && (
            <DeepSearchSection title="Additional Information" icon={Info}>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{ds.additionalInfo}</p>
            </DeepSearchSection>
          )}

          {/* Sources */}
          {ds.sourcesUsed.length > 0 && (
            <DeepSearchSection title="Sources" icon={Link2}>
              <ul className="space-y-2">
                {ds.sourcesUsed.map((source, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <ExternalLink className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-indigo-600 hover:text-indigo-700 font-medium break-all"
                      >
                        {source.title || source.url}
                      </a>
                      {source.title && (
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{source.url}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </DeepSearchSection>
          )}

          <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center pt-1">
            Scores and information are AI-generated estimates. Always verify details directly with funders.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Funder accordion ─────────────────────────────────────────────────────────

function FunderAccordion({
  group,
  defaultOpen = false,
  locale = 'en-NZ',
  deepSearchLoading,
  deepSearchIds,
  deepSearchData,
  onDeepSearch,
  shortlistedIds,
  onToggleShortlist,
}: {
  group: FunderGroup;
  defaultOpen?: boolean;
  locale?: string;
  deepSearchLoading?: string | null;
  deepSearchIds?: Map<string, string>;
  deepSearchData?: Map<string, DeepSearchResult>;
  onDeepSearch?: (grant: GrantOpportunity) => void;
  shortlistedIds?: Set<string>;
  onToggleShortlist?: (grant: GrantOpportunity) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [expandedGrantId, setExpandedGrantId] = useState<string | null>(null);
  const cfg = TYPE_CONFIG[group.type] ?? TYPE_CONFIG['Other'];

  const toggleGrant = (id: string) =>
    setExpandedGrantId(prev => (prev === id ? null : id));

  return (
    <div className={`bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 overflow-hidden shadow-sm border-l-4 ${cfg.border}`}>
      {/* Funder header */}
      <button
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-zinc-50/70 dark:hover:bg-zinc-800/50 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${cfg.icon}`}>
          <Building2 className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">{group.funder}</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ring-1 ${cfg.badge}`}>
              {group.type}
            </span>
            <span className="text-zinc-400 dark:text-zinc-500 text-xs">
              {group.grants.length} {group.grants.length === 1 ? 'program' : 'programs'}
            </span>
            {(() => {
              const deepCount = deepSearchIds ? group.grants.filter(g => deepSearchIds.has(g.id)).length : 0;
              return deepCount > 0 ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                  <Microscope className="w-3 h-3" />
                  {deepCount} researched
                </span>
              ) : null;
            })()}
            {(() => {
              const count = shortlistedIds ? group.grants.filter(g => shortlistedIds.has(g.id)).length : 0;
              return count > 0 ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                  <Star className="w-3 h-3 fill-amber-400" />
                  {count} shortlisted
                </span>
              ) : null;
            })()}
          </div>
        </div>

        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="hidden sm:flex flex-col items-center">
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 mb-1">Best match</span>
            <ScoreRing score={group.bestScore} size={44} />
          </div>
          {open
            ? <ChevronUp className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
            : <ChevronDown className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
          }
        </div>
      </button>

      {/* Grant programs */}
      {open && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
          {group.grants.map((grant, gi) => {
            const isExpanded = expandedGrantId === grant.id;
            const deadline = formatDeadline(grant.deadline, locale);
            const amount = formatAmountRange(grant.amountMin, grant.amountMax);

            return (
              <div key={`${grant.id}-${gi}`}>
                <button
                  className={`w-full flex items-center gap-4 pl-5 pr-4 py-3.5 text-left transition-colors ${
                    isExpanded ? 'bg-indigo-50/60 dark:bg-indigo-950/40' : 'bg-white dark:bg-zinc-800 hover:bg-zinc-50/70 dark:hover:bg-zinc-800/50'
                  }`}
                  onClick={() => toggleGrant(grant.id)}
                >
                  {/* Left spacer / status indicators */}
                  <div className="w-9 flex-shrink-0 flex flex-col items-center justify-center gap-1">
                    {deepSearchIds?.has(grant.id) && (
                      <Tooltip>
                        <TooltipTrigger className="flex items-center justify-center">
                          <Microscope className="w-3.5 h-3.5 text-emerald-600" />
                        </TooltipTrigger>
                        <TooltipContent>Deep research completed</TooltipContent>
                      </Tooltip>
                    )}
                    {shortlistedIds?.has(grant.id) && (
                      <Tooltip>
                        <TooltipTrigger className="flex items-center justify-center">
                          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                        </TooltipTrigger>
                        <TooltipContent>Shortlisted</TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium leading-snug ${isExpanded ? 'text-indigo-700 dark:text-indigo-400' : 'text-zinc-800 dark:text-zinc-200'}`}>
                      {grant.name}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      {amount && (
                        <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">{amount}</span>
                      )}
                      {deadline && (
                        <span className="flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
                          <CalendarDays className="w-3 h-3" />
                          {deadline}
                        </span>
                      )}
                      {!deadline && !amount && (
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">Open / Rolling</span>
                      )}
                    </div>
                  </div>

                  {/* Sub-scores — use deep search recalibrated scores when available */}
                  {(() => {
                    const ds = deepSearchData?.get(grant.id);
                    const scores = ds?.scores ?? grant.scores;
                    return (
                      <>
                        <div className="hidden lg:flex items-end gap-4 flex-shrink-0">
                          <ScorePill score={scores.alignment} label="Align" />
                          <ScorePill score={scores.ease} label="Ease" />
                          <ScorePill score={scores.attainability} label="Win" />
                        </div>

                        {/* Overall score */}
                        <div className="flex-shrink-0 ml-3 relative">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm text-white tabular-nums"
                            style={{ backgroundColor: scoreColor(scores.overall) }}
                          >
                            {(scores?.overall ?? 0).toFixed(1)}
                          </div>
                          {deepSearchIds?.has(grant.id) && (
                            <Tooltip>
                              <TooltipTrigger className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center ring-2 ring-white dark:ring-zinc-900">
                                <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                              </TooltipTrigger>
                              <TooltipContent>Deep research completed</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </>
                    );
                  })()}

                  <div className="text-zinc-400 dark:text-zinc-500 flex-shrink-0">
                    {isExpanded
                      ? <ChevronUp className="w-3.5 h-3.5" />
                      : <ChevronDown className="w-3.5 h-3.5" />
                    }
                  </div>
                </button>

                {isExpanded && (
                  <GrantDetail
                    grant={grant}
                    locale={locale}
                    deepSearchState={
                      deepSearchLoading === grant.id ? 'loading'
                      : deepSearchIds?.has(grant.id) ? 'complete'
                      : 'idle'
                    }
                    deepSearchData={deepSearchData?.get(grant.id)}
                    onDeepSearch={() => onDeepSearch?.(grant)}
                    isShortlisted={shortlistedIds?.has(grant.id) ?? false}
                    onToggleShortlist={() => onToggleShortlist?.(grant)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Results page ─────────────────────────────────────────────────────────────

export default function ResultsPage() {
  return (
    <Suspense fallback={null}>
      <ResultsContent />
    </Suspense>
  );
}

function ResultsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [minScore, setMinScore] = useState('5');
  const [sortField, setSortField] = useState<SortField>('overall');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Saved search context
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  // Deep search state
  const [deepSearchLoading, setDeepSearchLoading] = useState<string | null>(null);
  const [deepSearchIds, setDeepSearchIds] = useState<Map<string, string>>(new Map());
  const [deepSearchData, setDeepSearchData] = useState<Map<string, DeepSearchResult>>(new Map());
  const [deepSearchError, setDeepSearchError] = useState<string | null>(null);

  // Shortlist state
  const [shortlistedIds, setShortlistedIds] = useState<Set<string>>(new Set());

  // Streaming search state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<'triage' | 'scoring' | ''>('');
  const [streamProgress, setStreamProgress] = useState(0);
  const [streamError, setStreamError] = useState<string | null>(null);
  const searchStarted = useRef(false);

  // Animated progress for the initial wait before first batch completes
  const [animatedProgress, setAnimatedProgress] = useState(0);
  useEffect(() => {
    if (!isStreaming || streamProgress > 0) {
      setAnimatedProgress(0);
      return;
    }
    let p = 0;
    const interval = setInterval(() => {
      // Ease toward 20%, slowing as it approaches
      p += (20 - p) * 0.04 + Math.random() * 0.3;
      p = Math.min(p, 20);
      setAnimatedProgress(p);
    }, 800);
    return () => clearInterval(interval);
  }, [isStreaming, streamProgress]);

  useEffect(() => {
    async function load() {
      const mode = searchParams.get('mode');

      if (mode === 'search') {
        // Guard against React strict mode double-invocation
        if (searchStarted.current) return;
        searchStarted.current = true;

        // Streaming mode: initiate search from stored form
        const formData = sessionStorage.getItem('grantSearchForm');
        if (!formData) { router.replace('/'); return; }
        sessionStorage.removeItem('grantSearchForm');

        let form: OrgInfo;
        try { form = JSON.parse(formData); } catch { router.replace('/'); return; }

        setIsStreaming(true);
        setStreamPhase('triage');
        setStreamProgress(0);
        setResult({ grants: [], orgSummary: '', searchedAt: '', market: form.market || 'nz', inputs: form });

        try {
          const response = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
          });

          if (!response.ok) {
            const data = await response.json().catch(() => ({ error: 'Server error' }));
            throw new Error(data.error || 'Search failed');
          }

          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          const allGrants: GrantOpportunity[] = [];
          let orgSummary = '';
          let searchedAt = '';
          let marketId = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';

            for (const part of parts) {
              const dataLine = part.split('\n').find(l => l.startsWith('data: '));
              if (!dataLine) continue;
              let event: Record<string, unknown>;
              try { event = JSON.parse(dataLine.slice(6)); } catch { continue; }

              switch (event.type) {
                case 'progress': {
                  const completed = event.completed as number;
                  const total = event.total as number;
                  setStreamPhase(event.phase as 'triage' | 'scoring');
                  setStreamProgress(total > 0 ? completed / total : 0);
                  break;
                }
                case 'grants': {
                  const grants = event.grants as GrantOpportunity[];
                  allGrants.push(...grants);
                  if (event.orgSummary) orgSummary = event.orgSummary as string;
                  const completed = event.completed as number;
                  const total = event.total as number;
                  setStreamPhase('scoring');
                  setStreamProgress(total > 0 ? completed / total : 0);
                  // Update result incrementally so grants appear on screen
                  setResult(prev => prev ? {
                    ...prev,
                    grants: [...allGrants],
                    orgSummary: orgSummary || prev.orgSummary,
                  } : prev);
                  break;
                }
                case 'complete':
                  searchedAt = (event.searchedAt as string) || '';
                  marketId = (event.market as string) || '';
                  break;
                case 'error':
                  throw new Error(event.message as string);
              }
            }
          }

          const finalResult: SearchResult = {
            grants: allGrants,
            orgSummary,
            searchedAt: searchedAt || new Date().toISOString(),
            market: marketId || form.market || 'nz',
            inputs: form,
          };

          setResult(finalResult);
          setIsStreaming(false);
          setStreamPhase('');

          // Save and update URL
          sessionStorage.setItem('grantSearchResult', JSON.stringify(finalResult));
          const saved = await saveSearch(form.searchTitle?.trim() || '', finalResult);
          setSavedId(saved.id);
          setSavedName(form.searchTitle?.trim() || '');
          window.history.replaceState({}, '', `/results?saved=${saved.id}`);
        } catch (err) {
          console.error('Streaming search error:', err);
          setIsStreaming(false);
          setStreamError(err instanceof Error ? err.message : 'Search failed');
        }
        return;
      }

      // Normal mode: load from saved search or sessionStorage
      const id = searchParams.get('saved');
      if (id) {
        const saved = await getSaved(id);
        if (saved) {
          setResult(saved.result);
          setSavedId(id);
          setSavedName(saved.name);
          return;
        }
      }
      const stored = sessionStorage.getItem('grantSearchResult');
      if (!stored) { router.replace('/'); return; }
      try { setResult(JSON.parse(stored)); }
      catch { router.replace('/'); }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep search and shortlist state start empty for each search session.
  // Badges and recalibrated scores only reflect actions taken within this search,
  // since scores are context-specific (different funding purposes yield different scores).

  // Load full deep search data once we know which results have them
  useEffect(() => {
    if (!result || isStreaming) return;
    if (deepSearchIds.size === 0) return;
    const resultIds = new Set(result.grants.map(g => g.id));
    const relevantIds = [...deepSearchIds.keys()].filter(id => resultIds.has(id));
    if (relevantIds.length > 0) {
      batchGetDeepSearch(relevantIds).then(setDeepSearchData);
    }
  }, [result, isStreaming, deepSearchIds]);

  async function handleToggleShortlist(grant: GrantOpportunity) {
    const searchTitle = result?.inputs?.searchTitle
      || savedName
      || 'Untitled search';
    const wasShortlisted = shortlistedIds.has(grant.id);

    // Optimistic update — toggle UI immediately
    setShortlistedIds(prev => {
      const next = new Set(prev);
      if (wasShortlisted) next.delete(grant.id);
      else next.add(grant.id);
      return next;
    });

    // Server call — we already know the state, no need for toggleShortlist's extra fetch
    if (wasShortlisted) {
      await removeFromShortlist(grant.id);
    } else {
      await addToShortlist(grant, searchTitle);
    }
  }

  async function handleDeepSearch(grant: GrantOpportunity) {
    if (deepSearchLoading) return;
    if (!result?.inputs) {
      setDeepSearchError('Organisation context not available. Please run a new search first.');
      return;
    }
    setDeepSearchLoading(grant.id);
    setDeepSearchError(null);

    try {
      const response = await fetch('/api/deep-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant: {
            id: grant.id,
            name: grant.name,
            funder: grant.funder,
            url: grant.url,
            description: grant.description,
            scores: grant.scores,
            alignmentReason: grant.alignmentReason,
            applicationNotes: grant.applicationNotes,
            attainabilityNotes: grant.attainabilityNotes,
            amountMin: grant.amountMin,
            amountMax: grant.amountMax,
            deadline: grant.deadline,
          },
          orgContext: result.inputs,
          market: result.market || 'nz',
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Server error' }));
        throw new Error(data.error || 'Deep search failed');
      }

      const deepResult: DeepSearchResult = await response.json();
      await saveDeepSearch(deepResult);
      setDeepSearchIds(prev => {
        const next = new Map(prev);
        next.set(grant.id, deepResult.searchedAt);
        return next;
      });
      setDeepSearchData(prev => {
        const next = new Map(prev);
        next.set(grant.id, deepResult);
        return next;
      });
    } catch (err) {
      console.error('Deep search error:', err);
      setDeepSearchError(err instanceof Error ? err.message : 'Deep search failed');
    } finally {
      setDeepSearchLoading(null);
    }
  }

  // Return deep-search-recalibrated scores when available, otherwise original scores
  const effectiveScores = (g: GrantOpportunity) => {
    const ds = deepSearchData.get(g.id);
    return ds?.scores ?? g.scores;
  };

  const funderGroups = useMemo((): FunderGroup[] => {
    if (!result) return [];
    let grants = result.grants.filter(g => effectiveScores(g)?.overall !== undefined);

    const min = parseFloat(minScore);
    if (min > 0) grants = grants.filter(g => effectiveScores(g).overall >= min);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      grants = grants.filter(g =>
        g.name.toLowerCase().includes(q) ||
        g.funder.toLowerCase().includes(q) ||
        g.description.toLowerCase().includes(q)
      );
    }

    if (typeFilter !== 'all') {
      grants = grants.filter(g => g.type === typeFilter);
    }

    const map = new Map<string, GrantOpportunity[]>();
    for (const g of grants) {
      const existing = map.get(g.funder) || [];
      existing.push(g);
      map.set(g.funder, existing);
    }

    const groups: FunderGroup[] = Array.from(map.entries()).map(([funder, fGrants]) => {
      const sorted = [...fGrants].sort((a, b) => {
        let av: number | string, bv: number | string;
        const aScores = effectiveScores(a);
        const bScores = effectiveScores(b);
        switch (sortField) {
          case 'overall':               av = aScores.overall;               bv = bScores.overall; break;
          case 'alignment':             av = aScores.alignment;             bv = bScores.alignment; break;
          case 'attainability':         av = aScores.attainability;         bv = bScores.attainability; break;
          case 'ease':                  av = aScores.ease;                  bv = bScores.ease; break;
          case 'deadline':              av = a.deadline || 'ZZZ';            bv = b.deadline || 'ZZZ'; break;
          default:                      av = aScores.overall;               bv = bScores.overall;
        }
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
      const bestScore = Math.max(...fGrants.map(g => effectiveScores(g)?.overall ?? 0));
      return { funder, type: fGrants[0].type, grants: sorted, bestScore };
    });

    return groups.sort((a, b) => {
      if (sortField === 'deadline') {
        const aMin = a.grants[0]?.deadline || 'ZZZ';
        const bMin = b.grants[0]?.deadline || 'ZZZ';
        return sortDir === 'asc' ? aMin.localeCompare(bMin) : bMin.localeCompare(aMin);
      }
      return sortDir === 'asc' ? a.bestScore - b.bestScore : b.bestScore - a.bestScore;
    });
  }, [result, searchQuery, typeFilter, sortField, sortDir, minScore, deepSearchData]);

  const totalShown = funderGroups.reduce((sum, g) => sum + g.grants.length, 0);
  const market = result ? getMarket(result.market ?? 'nz') : null;

  if (!result) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 rounded-full bg-teal-50 dark:bg-teal-950 flex items-center justify-center mx-auto mb-4">
            <Search className="w-5 h-5 text-teal-600 animate-pulse" />
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 font-medium">Loading results...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      {/* ── Page header ── */}
      <div className="bg-white dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
        <div className="max-w-6xl mx-auto px-6 py-5">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors mb-4 group"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            New Search
          </button>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                {result.inputs?.searchTitle || savedName || 'Grant Opportunities'}
              </h1>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 bg-teal-50 dark:bg-teal-950 text-teal-700 text-sm font-semibold px-3 py-1 rounded-full">
                  {isStreaming ? (
                    <>{result.grants.length} grants so far...</>
                  ) : (
                    <>{totalShown} grants · {funderGroups.length} funders</>
                  )}
                </span>
                {!isStreaming && result.searchedAt && (
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    Searched {new Date(result.searchedAt).toLocaleString(market?.locale ?? 'en-NZ', {
                      day: 'numeric', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white text-sm font-semibold rounded-xl shadow-sm shadow-teal-200 dark:shadow-none transition-all"
            >
              <Search className="w-3.5 h-3.5" />
              New Search
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {/* ── Streaming progress ── */}
        {isStreaming && (() => {
          const displayProgress = streamProgress > 0
            ? streamProgress * 100
            : animatedProgress;
          return (
            <div className="bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 p-5 shadow-sm border-l-4 border-l-teal-500">
              <div className="flex items-center gap-3 mb-3">
                <Loader2 className="w-4 h-4 animate-spin text-teal-600 flex-shrink-0" />
                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  {streamProgress > 0
                    ? 'Scoring and ranking grants...'
                    : 'Analysing grants...'}
                </span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-auto tabular-nums">
                  {Math.round(displayProgress)}%
                </span>
              </div>
              <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden mb-3">
                <div
                  className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${displayProgress}%` }}
                />
              </div>
              {result && result.grants.length > 0 ? (
                <span className="text-xs text-teal-600 font-medium">
                  {result.grants.length} grant{result.grants.length !== 1 ? 's' : ''} found so far
                </span>
              ) : (
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  Results will appear as grants are scored
                </span>
              )}
            </div>
          );
        })()}

        {/* ── Stream error ── */}
        {streamError && (
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl px-5 py-4 shadow-sm">
            <p className="text-sm font-medium text-red-700 mb-2">Search failed</p>
            <p className="text-sm text-red-600">{streamError}</p>
            <button
              onClick={() => router.push('/')}
              className="mt-3 text-sm font-medium text-red-700 hover:text-red-800 underline"
            >
              Back to search
            </button>
          </div>
        )}

        {/* ── Org summary ── */}
        {result.orgSummary && (
          <div className="bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 p-5 shadow-sm border-l-4 border-l-teal-500">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-teal-700 uppercase tracking-wider">Organisation Summary</span>
            </div>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{result.orgSummary}</p>
          </div>
        )}

        {/* ── Filter toolbar ── */}
        <div className="bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-sm overflow-hidden sticky top-16 z-20">
          <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500 font-medium mr-1">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filter &amp; sort
            </div>

            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
              <Input
                placeholder="Search grants or funders..."
                className="pl-9 h-9 text-sm border-zinc-200 dark:border-zinc-700 focus-visible:ring-teal-500 bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-100"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            <Select value={typeFilter} onValueChange={v => setTypeFilter(v ?? 'all')}>
              <SelectTrigger className="w-[140px] h-9 text-sm border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-100">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="Government">Government</SelectItem>
                <SelectItem value="Foundation">Foundation</SelectItem>
                <SelectItem value="Corporate">Corporate</SelectItem>
                <SelectItem value="Community">Community</SelectItem>
                <SelectItem value="International">International</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>

            <Select value={minScore} onValueChange={v => setMinScore(v ?? '5')}>
              <SelectTrigger className="w-[130px] h-9 text-sm border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">All scores</SelectItem>
                <SelectItem value="5">Score ≥ 5</SelectItem>
                <SelectItem value="6">Score ≥ 6</SelectItem>
                <SelectItem value="7">Score ≥ 7</SelectItem>
                <SelectItem value="8">Score ≥ 8</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortField} onValueChange={v => setSortField((v ?? 'overall') as SortField)}>
              <SelectTrigger className="w-[170px] h-9 text-sm border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="overall">Sort: Overall score</SelectItem>
                <SelectItem value="alignment">Sort: Alignment</SelectItem>
                <SelectItem value="attainability">Sort: Attainability</SelectItem>
                <SelectItem value="ease">Sort: Easiest first</SelectItem>
                <SelectItem value="deadline">Sort: Deadline</SelectItem>
              </SelectContent>
            </Select>

            <button
              onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-zinc-500 dark:text-zinc-400"
              title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            >
              {sortDir === 'asc'
                ? <ArrowUp className="w-3.5 h-3.5" />
                : <ArrowDown className="w-3.5 h-3.5" />
              }
            </button>

            <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-auto whitespace-nowrap">
              {totalShown} of {result.grants.length}
            </span>
          </div>

          {/* Score legend */}
          <div className="px-4 py-2.5 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 flex items-center gap-5 flex-wrap">
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500 font-medium">Score scale:</span>
            {[
              ['8–10', '#10b981', 'Excellent match'],
              ['6.5–8', '#f59e0b', 'Good match'],
              ['5–6.5', '#f97316', 'Partial match'],
              ['0–5', '#ef4444', 'Low match'],
            ].map(([range, color, label]) => (
              <div key={range} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span className="font-medium">{range}</span>
                  <span className="text-zinc-400 dark:text-zinc-500 ml-1">{label}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Results ── */}
        {funderGroups.length === 0 && !isStreaming ? (
          <div className="bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 py-20 text-center shadow-sm">
            <Search className="w-8 h-8 mx-auto mb-3 text-zinc-300 dark:text-zinc-600" />
            <p className="font-semibold text-zinc-500 dark:text-zinc-400 text-sm">No grants match your filters</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">Try lowering the minimum score or clearing the search</p>
          </div>
        ) : funderGroups.length === 0 && isStreaming ? (
          null
        ) : (
          <div className="space-y-3">
            {funderGroups.map((group, i) => (
              <FunderAccordion
                key={group.funder}
                group={group}
                defaultOpen={false}
                locale={market?.locale}
                deepSearchLoading={deepSearchLoading}
                deepSearchIds={deepSearchIds}
                deepSearchData={deepSearchData}
                onDeepSearch={handleDeepSearch}
                shortlistedIds={shortlistedIds}
                onToggleShortlist={handleToggleShortlist}
              />
            ))}
          </div>
        )}

        {/* Deep search error toast */}
        {deepSearchError && (
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-red-700">{deepSearchError}</p>
            <button onClick={() => setDeepSearchError(null)} className="text-red-400 hover:text-red-600 ml-3">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <p className="text-center text-xs text-zinc-400 dark:text-zinc-500 pt-2 pb-4">
          Scores are AI-generated estimates. Always verify grant details directly with funders before applying.
        </p>
      </div>
    </div>
  );
}
