'use client';

import { Suspense, useEffect, useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ArrowUp, ArrowDown, Search, ExternalLink,
  ChevronDown, ChevronUp, CalendarDays, Building2,
  SlidersHorizontal, X, Star,
  Microscope, Loader2, CheckCircle2, RotateCw,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchResult, GrantOpportunity, DeepSearchResult } from '@/lib/types';
import { getMarket } from '@/lib/markets';
import { getSaved } from '@/lib/saved-searches';
import { saveDeepSearch } from '@/lib/deep-search-storage';
import { batchCheckDeepSearch } from '@/lib/deep-search-storage';
import { toggleShortlist, batchCheckShortlisted } from '@/lib/shortlist-storage';
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

function scoreColor(score?: number): string {
  const s = score ?? 0;
  if (s >= 8) return '#10b981';  // emerald
  if (s >= 6.5) return '#f59e0b'; // amber
  if (s >= 5) return '#f97316';   // orange
  return '#ef4444';               // red
}

function scoreTextClass(score?: number): string {
  const s = score ?? 0;
  if (s >= 8) return 'text-emerald-700 bg-emerald-50';
  if (s >= 6.5) return 'text-amber-700 bg-amber-50';
  if (s >= 5) return 'text-orange-600 bg-orange-50';
  return 'text-red-600 bg-red-50';
}

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
          fill="none" stroke="#f4f4f5" strokeWidth={strokeW}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={strokeW}
          strokeDasharray={`${arc} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-bold text-zinc-800 tabular-nums" style={{ fontSize: size < 44 ? 10 : 12 }}>
          {s.toFixed(1)}
        </span>
      </div>
      {validated && (
        <Tooltip>
          <TooltipTrigger className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center ring-2 ring-white">
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
      <span className="text-[9px] text-zinc-400 font-medium uppercase tracking-wide">{label}</span>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function formatDeadline(d?: string, locale = 'en-NZ') {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return d; }
}

// ─── Grant detail panel ───────────────────────────────────────────────────────

function GrantDetail({
  grant,
  locale,
  deepSearchState = 'idle',
  deepSearchedAt,
  onDeepSearch,
  isShortlisted = false,
  onToggleShortlist,
}: {
  grant: GrantOpportunity;
  locale: string;
  deepSearchState?: 'idle' | 'loading' | 'complete';
  deepSearchedAt?: string;
  onDeepSearch?: () => void;
  isShortlisted?: boolean;
  onToggleShortlist?: () => void;
}) {
  const deadline = formatDeadline(grant.deadline, locale);
  const amount = formatAmountRange(grant.amountMin, grant.amountMax);

  return (
    <div className="bg-zinc-50 border-t border-zinc-200 px-6 py-6">
      {/* Meta row */}
      {(amount || deadline) && (
        <div className="flex flex-wrap gap-4 mb-5">
          {amount && (
            <div className="text-xs">
              <span className="text-zinc-400 mr-1.5">Amount</span>
              <span className="font-semibold text-zinc-700">{amount}</span>
            </div>
          )}
          {deadline && (
            <div className="text-xs flex items-center gap-1">
              <CalendarDays className="w-3 h-3 text-zinc-400" />
              <span className="text-zinc-400 mr-1">Closes</span>
              <span className="font-semibold text-zinc-700">{deadline}</span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Description */}
        <div>
          <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">About this grant</h4>
          <p className="text-sm text-zinc-700 leading-relaxed">{grant.description}</p>
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
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-200">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Researching...
              </div>
            )}
            {deepSearchState === 'complete' && (
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`/grant/${encodeURIComponent(grant.id)}/deep-search`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  View Deep Search
                </a>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeepSearch?.(); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-100 text-zinc-600 hover:bg-zinc-200 ring-1 ring-zinc-200 transition-colors"
                >
                  <RotateCw className="w-3 h-3" />
                  Re-run
                </button>
                {deepSearchedAt && (
                  <span className="text-[11px] text-zinc-400">
                    Last run {new Date(deepSearchedAt).toLocaleString(locale, {
                      day: 'numeric', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Shortlist button — requires deep search first */}
          <div className="mt-2">
            {deepSearchState === 'complete' ? (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleShortlist?.(); }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  isShortlisted
                    ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                    : 'bg-white border-zinc-300 text-zinc-700 hover:border-amber-400 hover:text-amber-700'
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${isShortlisted ? 'fill-amber-400' : ''}`} />
                {isShortlisted ? 'Shortlisted' : 'Shortlist'}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 italic">
                Run Deep Search to shortlist
              </span>
            )}
          </div>
        </div>

        {/* Alignment + Application */}
        <div className="space-y-5">
          <div>
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Why it fits</h4>
            <p className="text-sm text-zinc-700 leading-relaxed">{grant.alignmentReason}</p>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">How to apply</h4>
            <p className="text-sm text-zinc-700 leading-relaxed">{grant.applicationNotes}</p>
          </div>
        </div>

        {/* Attainability + Score breakdown */}
        <div className="space-y-5">
          <div>
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Attainability</h4>
            <p className="text-sm text-zinc-700 leading-relaxed">{grant.attainabilityNotes}</p>
          </div>

          <div className="bg-white rounded-xl border border-zinc-200 p-4">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Score breakdown</p>
            <div className="space-y-2.5">
              {[
                { label: 'Alignment', score: grant.scores?.alignment ?? 0 },
                { label: 'Ease', score: grant.scores?.ease ?? 0 },
                { label: 'Attainability', score: grant.scores?.attainability ?? 0 },
              ].map(({ label, score }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">{label}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${score * 10}%`,
                          backgroundColor: scoreColor(score),
                        }}
                      />
                    </div>
                    <span className="text-xs font-bold text-zinc-700 tabular-nums w-6 text-right">
                      {score.toFixed(1)}
                    </span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
                <span className="text-xs font-semibold text-zinc-700">Overall</span>
                <span className="text-sm font-bold text-zinc-900 tabular-nums">
                  {(grant.scores?.overall ?? 0).toFixed(1)}
                  <span className="text-xs font-normal text-zinc-400">/10</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Funder accordion ─────────────────────────────────────────────────────────

function FunderAccordion({
  group,
  defaultOpen = false,
  locale = 'en-NZ',
  deepSearchLoading,
  deepSearchComplete,
  onDeepSearch,
  shortlistedIds,
  onToggleShortlist,
}: {
  group: FunderGroup;
  defaultOpen?: boolean;
  locale?: string;
  deepSearchLoading?: string | null;
  deepSearchComplete?: Map<string, string>;
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
    <div className={`bg-white rounded-xl ring-1 ring-zinc-200 overflow-hidden shadow-sm border-l-4 ${cfg.border}`}>
      {/* Funder header */}
      <button
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-zinc-50/70 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${cfg.icon}`}>
          <Building2 className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-semibold text-zinc-900 text-sm">{group.funder}</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ring-1 ${cfg.badge}`}>
              {group.type}
            </span>
            <span className="text-zinc-400 text-xs">
              {group.grants.length} {group.grants.length === 1 ? 'program' : 'programs'}
            </span>
            {(() => {
              const deepCount = deepSearchComplete ? group.grants.filter(g => deepSearchComplete.has(g.id)).length : 0;
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
            <span className="text-[10px] text-zinc-400 mb-1">Best match</span>
            <ScoreRing score={group.bestScore} size={44} />
          </div>
          {open
            ? <ChevronUp className="w-4 h-4 text-zinc-400" />
            : <ChevronDown className="w-4 h-4 text-zinc-400" />
          }
        </div>
      </button>

      {/* Grant programs */}
      {open && (
        <div className="border-t border-zinc-100 divide-y divide-zinc-100">
          {group.grants.map((grant, gi) => {
            const isExpanded = expandedGrantId === grant.id;
            const deadline = formatDeadline(grant.deadline, locale);
            const amount = formatAmountRange(grant.amountMin, grant.amountMax);

            return (
              <div key={`${grant.id}-${gi}`}>
                <button
                  className={`w-full flex items-center gap-4 pl-5 pr-4 py-3.5 text-left transition-colors ${
                    isExpanded ? 'bg-indigo-50/60' : 'bg-white hover:bg-zinc-50/70'
                  }`}
                  onClick={() => toggleGrant(grant.id)}
                >
                  {/* Left spacer / status indicators */}
                  <div className="w-9 flex-shrink-0 flex flex-col items-center justify-center gap-1">
                    {deepSearchComplete?.has(grant.id) && (
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
                    <p className={`text-sm font-medium leading-snug ${isExpanded ? 'text-indigo-700' : 'text-zinc-800'}`}>
                      {grant.name}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      {amount && (
                        <span className="text-xs text-zinc-400 tabular-nums">{amount}</span>
                      )}
                      {deadline && (
                        <span className="flex items-center gap-1 text-xs text-zinc-400">
                          <CalendarDays className="w-3 h-3" />
                          {deadline}
                        </span>
                      )}
                      {!deadline && !amount && (
                        <span className="text-xs text-zinc-400">Open / Rolling</span>
                      )}
                    </div>
                  </div>

                  {/* Sub-scores */}
                  <div className="hidden lg:flex items-end gap-4 flex-shrink-0">
                    <ScorePill score={grant.scores.alignment} label="Align" />
                    <ScorePill score={grant.scores.ease} label="Ease" />
                    <ScorePill score={grant.scores.attainability} label="Win" />
                  </div>

                  {/* Overall score */}
                  <div className="flex-shrink-0 ml-3 relative">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm text-white tabular-nums"
                      style={{ backgroundColor: scoreColor(grant.scores.overall) }}
                    >
                      {(grant.scores?.overall ?? 0).toFixed(1)}
                    </div>
                    {deepSearchComplete?.has(grant.id) && (
                      <Tooltip>
                        <TooltipTrigger className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center ring-2 ring-white">
                          <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                        </TooltipTrigger>
                        <TooltipContent>Deep research completed</TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  <div className="text-zinc-400 flex-shrink-0">
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
                      : deepSearchComplete?.has(grant.id) ? 'complete'
                      : 'idle'
                    }
                    deepSearchedAt={deepSearchComplete?.get(grant.id)}
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
  const [deepSearchComplete, setDeepSearchComplete] = useState<Map<string, string>>(new Map());
  const [deepSearchError, setDeepSearchError] = useState<string | null>(null);

  // Shortlist state
  const [shortlistedIds, setShortlistedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
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
  }, [router, searchParams]);

  // Scan DB for existing deep searches and shortlists on mount
  useEffect(() => {
    if (!result) return;
    const ids = result.grants.map(g => g.id);
    Promise.all([
      batchCheckDeepSearch(ids),
      batchCheckShortlisted(ids),
    ]).then(([deepMap, shortIds]) => {
      setDeepSearchComplete(deepMap);
      setShortlistedIds(shortIds);
    });
  }, [result]);

  async function handleToggleShortlist(grant: GrantOpportunity) {
    const searchTitle = result?.inputs?.searchTitle
      || savedName
      || 'Untitled search';
    const nowShortlisted = await toggleShortlist(grant, searchTitle);
    setShortlistedIds(prev => {
      const next = new Set(prev);
      if (nowShortlisted) next.add(grant.id);
      else next.delete(grant.id);
      return next;
    });
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
      setDeepSearchComplete(prev => {
        const next = new Map(prev);
        next.set(grant.id, deepResult.searchedAt);
        return next;
      });
    } catch (err) {
      console.error('Deep search error:', err);
      setDeepSearchError(err instanceof Error ? err.message : 'Deep search failed');
    } finally {
      setDeepSearchLoading(null);
    }
  }

  const funderGroups = useMemo((): FunderGroup[] => {
    if (!result) return [];
    let grants = result.grants.filter(g => g.scores?.overall !== undefined);

    const min = parseFloat(minScore);
    if (min > 0) grants = grants.filter(g => g.scores.overall >= min);

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
        switch (sortField) {
          case 'overall':               av = a.scores.overall;               bv = b.scores.overall; break;
          case 'alignment':             av = a.scores.alignment;             bv = b.scores.alignment; break;
          case 'attainability':         av = a.scores.attainability;         bv = b.scores.attainability; break;
          case 'ease':                  av = a.scores.ease;                  bv = b.scores.ease; break;
          case 'deadline':              av = a.deadline || 'ZZZ';            bv = b.deadline || 'ZZZ'; break;
          default:                      av = a.scores.overall;               bv = b.scores.overall;
        }
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
      const bestScore = Math.max(...fGrants.map(g => g.scores?.overall ?? 0));
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
  }, [result, searchQuery, typeFilter, sortField, sortDir, minScore]);

  const totalShown = funderGroups.reduce((sum, g) => sum + g.grants.length, 0);
  const market = result ? getMarket(result.market ?? 'nz') : null;

  if (!result) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center mx-auto mb-4">
            <Search className="w-5 h-5 text-teal-600 animate-pulse" />
          </div>
          <p className="text-sm text-zinc-500 font-medium">Loading results...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* ── Page header ── */}
      <div className="bg-white border-b border-zinc-200">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 transition-colors mb-4 group"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            New search
          </button>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-zinc-900">
                {result.inputs?.searchTitle || savedName || 'Grant Opportunities'}
              </h1>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 bg-teal-50 text-teal-700 text-sm font-semibold px-3 py-1 rounded-full">
                  {totalShown} grants · {funderGroups.length} funders
                </span>
                <span className="text-xs text-zinc-400">
                  Searched {new Date(result.searchedAt).toLocaleString(market?.locale ?? 'en-NZ', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
            </div>

            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white text-sm font-semibold rounded-xl shadow-sm shadow-teal-200 transition-all"
            >
              <Search className="w-3.5 h-3.5" />
              New Search
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">
        {/* ── Org summary ── */}
        {result.orgSummary && (
          <div className="bg-white rounded-xl ring-1 ring-zinc-200 p-5 shadow-sm border-l-4 border-l-teal-500">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-teal-700 uppercase tracking-wider">Organisation Summary</span>
            </div>
            <p className="text-sm text-zinc-700 leading-relaxed">{result.orgSummary}</p>
          </div>
        )}

        {/* ── Filter toolbar ── */}
        <div className="bg-white rounded-xl ring-1 ring-zinc-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs text-zinc-400 font-medium mr-1">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filter &amp; sort
            </div>

            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
              <Input
                placeholder="Search grants or funders..."
                className="pl-9 h-9 text-sm border-zinc-200 focus-visible:ring-teal-500 bg-zinc-50"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            <Select value={typeFilter} onValueChange={v => setTypeFilter(v ?? 'all')}>
              <SelectTrigger className="w-[140px] h-9 text-sm border-zinc-200 bg-zinc-50">
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
              <SelectTrigger className="w-[130px] h-9 text-sm border-zinc-200 bg-zinc-50">
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
              <SelectTrigger className="w-[170px] h-9 text-sm border-zinc-200 bg-zinc-50">
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
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 transition-colors text-zinc-500"
              title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            >
              {sortDir === 'asc'
                ? <ArrowUp className="w-3.5 h-3.5" />
                : <ArrowDown className="w-3.5 h-3.5" />
              }
            </button>

            <span className="text-xs text-zinc-400 ml-auto whitespace-nowrap">
              {totalShown} of {result.grants.length}
            </span>
          </div>

          {/* Score legend */}
          <div className="px-4 py-2.5 border-t border-zinc-100 bg-zinc-50 flex items-center gap-5 flex-wrap">
            <span className="text-[11px] text-zinc-400 font-medium">Score scale:</span>
            {[
              ['8–10', '#10b981', 'Excellent match'],
              ['6.5–8', '#f59e0b', 'Good match'],
              ['5–6.5', '#f97316', 'Partial match'],
              ['0–5', '#ef4444', 'Low match'],
            ].map(([range, color, label]) => (
              <div key={range} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[11px] text-zinc-500">
                  <span className="font-medium">{range}</span>
                  <span className="text-zinc-400 ml-1">{label}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Results ── */}
        {funderGroups.length === 0 ? (
          <div className="bg-white rounded-xl ring-1 ring-zinc-200 py-20 text-center shadow-sm">
            <Search className="w-8 h-8 mx-auto mb-3 text-zinc-300" />
            <p className="font-semibold text-zinc-500 text-sm">No grants match your filters</p>
            <p className="text-xs text-zinc-400 mt-1">Try lowering the minimum score or clearing the search</p>
          </div>
        ) : (
          <div className="space-y-3">
            {funderGroups.map((group, i) => (
              <FunderAccordion
                key={group.funder}
                group={group}
                defaultOpen={false}
                locale={market?.locale}
                deepSearchLoading={deepSearchLoading}
                deepSearchComplete={deepSearchComplete}
                onDeepSearch={handleDeepSearch}
                shortlistedIds={shortlistedIds}
                onToggleShortlist={handleToggleShortlist}
              />
            ))}
          </div>
        )}

        {/* Deep search error toast */}
        {deepSearchError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-red-700">{deepSearchError}</p>
            <button onClick={() => setDeepSearchError(null)} className="text-red-400 hover:text-red-600 ml-3">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <p className="text-center text-xs text-zinc-400 pt-2 pb-4">
          Scores are AI-generated estimates. Always verify grant details directly with funders before applying.
        </p>
      </div>
    </div>
  );
}
