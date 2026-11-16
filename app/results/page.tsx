'use client';

import { Suspense, useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, ArrowUp, ArrowDown, Search, ExternalLink,
  ChevronDown, CalendarDays, Building2,
  SlidersHorizontal, Star, Microscope, Loader2, CheckCircle2, RotateCw,
  Download, AlertTriangle, List, Layers,
} from 'lucide-react';
import { formatAmountRange, formatDeadline, SCORE_BANDS } from '@/lib/formatting';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchResult, GrantOpportunity, DeepSearchResult, OrgInfo } from '@/lib/types';
import { getMarket } from '@/lib/markets';
import { getSaved, saveSearch, updateSaved } from '@/lib/saved-searches';
import { useDeepSearchMap, runDeepSearch } from '@/lib/deep-search-storage';
import { addToShortlist, removeFromShortlist, getAllShortlistedIds } from '@/lib/shortlist-storage';
import { ApiRequestError, errorMessage } from '@/lib/fetcher';
import { downloadCsv, slugForFilename } from '@/lib/csv';
import { GRANT_TYPES, typeConfig, LINK_CLASS, PRIMARY_BUTTON_CLASS } from '@/lib/grant-ui';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ScoreBadge, ScoreRing, SubScores, ScoreBreakdown } from '@/components/grant/score';
import DeepSearchDetails, { safeHref } from '@/components/grant/deep-search-details';
import { toast } from '@/components/toast';

// ─── Types ────────────────────────────────────────────────────────────────────

type SortField = 'overall' | 'alignment' | 'attainability' | 'ease' | 'deadline';
type SortDir = 'asc' | 'desc';
type DeepState = 'idle' | 'loading' | 'complete';
/** `grants` = one flat ranked list; `funders` = grouped by funder. */
type ViewMode = 'grants' | 'funders';
type QuickFilter = 'shortlisted' | 'researched' | 'deadline';

interface FunderGroup {
  funder: string;
  type: GrantOpportunity['type'];
  grants: GrantOpportunity[];
  bestScore: number;
}

const DEFAULT_MIN_SCORE = '6';

// Labels for the toolbar dropdowns. The select shows whatever is rendered
// inside <SelectValue>, so each trigger looks its label up here — otherwise it
// displays the raw value ("all", "6", "overall").
const MIN_SCORE_OPTIONS = [
  { value: '0', label: 'All scores' },
  { value: '5', label: 'Score ≥ 5' },
  { value: '6', label: 'Score ≥ 6' },
  { value: '7', label: 'Score ≥ 7' },
  { value: '8', label: 'Score ≥ 8' },
] as const;

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'overall', label: 'Sort: Overall score' },
  { value: 'alignment', label: 'Sort: Alignment' },
  { value: 'attainability', label: 'Sort: Attainability' },
  { value: 'ease', label: 'Sort: Ease of applying' },
  { value: 'deadline', label: 'Sort: Deadline' },
];

// ─── Grant detail panel ───────────────────────────────────────────────────────

function GrantDetail({
  grant,
  locale,
  deepSearchState,
  deepSearchData,
  canDeepSearch,
  onDeepSearch,
  isShortlisted,
  onToggleShortlist,
}: {
  grant: GrantOpportunity;
  locale: string;
  deepSearchState: DeepState;
  deepSearchData?: DeepSearchResult | null;
  /** False while another grant is being researched (one at a time). */
  canDeepSearch: boolean;
  onDeepSearch: () => void;
  isShortlisted: boolean;
  onToggleShortlist: () => void;
}) {
  const [showDeepSearch, setShowDeepSearch] = useState(false);
  const deadline = formatDeadline(grant.deadline, locale);
  const amount = formatAmountRange(grant.amountMin, grant.amountMax);
  const ds = deepSearchData;
  const grantHref = safeHref(grant.url);

  return (
    <div className="bg-zinc-50 dark:bg-zinc-900/40 border-t border-zinc-200 dark:border-zinc-700 px-5 sm:px-6 py-6">
      {/* Meta row */}
      {(amount || deadline) && (
        <div className="flex flex-wrap gap-4 mb-5 text-xs">
          {amount && (
            <div>
              <span className="text-zinc-500 dark:text-zinc-400 mr-1.5">Amount</span>
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">{amount}</span>
            </div>
          )}
          {deadline && (
            <div className="flex items-center gap-1">
              <CalendarDays className="w-3 h-3 text-zinc-400 dark:text-zinc-500" aria-hidden />
              <span className="text-zinc-500 dark:text-zinc-400 mr-1">Closes</span>
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">{deadline}</span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Description */}
        <div>
          <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">About this grant</h4>
          <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
            {grant.description || 'No description available yet — run a Deep Search to research this grant.'}
          </p>
          {grantHref && (
            <a
              href={grantHref}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 mt-4 text-xs group ${LINK_CLASS}`}
            >
              View grant page
              <ExternalLink className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" aria-hidden />
            </a>
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
          <ScoreBreakdown scores={ds?.scores ?? grant.scores} />
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="flex flex-wrap items-center gap-2 mt-6 pt-5 border-t border-zinc-200 dark:border-zinc-700">
        <button
          type="button"
          onClick={onToggleShortlist}
          aria-pressed={isShortlisted}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
            isShortlisted
              ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900'
              : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:border-amber-400 hover:text-amber-700 dark:hover:text-amber-300'
          }`}
        >
          <Star className={`w-3.5 h-3.5 ${isShortlisted ? 'fill-amber-400 text-amber-400' : ''}`} aria-hidden />
          {isShortlisted ? 'Shortlisted' : 'Shortlist'}
        </button>

        {deepSearchState === 'idle' && (
          <button
            type="button"
            onClick={onDeepSearch}
            disabled={!canDeepSearch}
            title={canDeepSearch ? undefined : 'Another grant is being researched — one at a time'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ${PRIMARY_BUTTON_CLASS}`}
          >
            <Microscope className="w-3.5 h-3.5" aria-hidden />
            Deep Search
          </button>
        )}
        {deepSearchState === 'loading' && (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 ring-1 ring-teal-200 dark:ring-teal-800"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
            Researching — this takes about a minute…
          </span>
        )}
        {deepSearchState === 'complete' && (
          <>
            <button
              type="button"
              onClick={() => setShowDeepSearch(v => !v)}
              aria-expanded={showDeepSearch}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800 dark:hover:bg-emerald-900 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
              {showDeepSearch ? 'Hide research' : 'Show research'}
              <ChevronDown className={`w-3 h-3 transition-transform ${showDeepSearch ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            <button
              type="button"
              onClick={onDeepSearch}
              disabled={!canDeepSearch}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 ring-1 ring-zinc-200 dark:ring-zinc-700 transition-colors disabled:opacity-50"
            >
              <RotateCw className="w-3 h-3" aria-hidden />
              Re-run
            </button>
            {ds?.searchedAt && (
              <span className="text-[11px] text-zinc-500 dark:text-zinc-500">
                Researched {new Date(ds.searchedAt).toLocaleString(locale, {
                  day: 'numeric', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            )}
          </>
        )}
        {deepSearchState === 'idle' && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Deep Search finds deadlines, eligibility and an application checklist.
          </span>
        )}
      </div>

      {/* ── Inline Deep Search Results ── */}
      {showDeepSearch && ds && (
        <div className="mt-6">
          <DeepSearchDetails deep={ds} variant="card" showOverallChange />
          <p className="text-xs text-zinc-500 dark:text-zinc-500 text-center pt-4">
            Scores and information are AI-generated estimates. Always verify details directly with funders.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Grant row (shared by the list and by-funder views) ─────────────────────

interface RowActions {
  locale: string;
  deepSearchLoading: string | null;
  deepSearchData: Map<string, DeepSearchResult>;
  onDeepSearch: (grant: GrantOpportunity) => void;
  shortlistedIds: Set<string>;
  onToggleShortlist: (grant: GrantOpportunity) => void;
}

function GrantRow({
  grant,
  showFunder,
  expanded,
  onToggle,
  locale,
  deepSearchLoading,
  deepSearchData,
  onDeepSearch,
  shortlistedIds,
  onToggleShortlist,
}: RowActions & {
  grant: GrantOpportunity;
  /** Show the funder and type under the name (list view). */
  showFunder: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const deadline = formatDeadline(grant.deadline, locale);
  const amount = formatAmountRange(grant.amountMin, grant.amountMax);
  const ds = deepSearchData.get(grant.id);
  const scores = ds?.scores ?? grant.scores;
  const shortlisted = shortlistedIds.has(grant.id);
  const cfg = typeConfig(grant.type);

  return (
    <li>
      <button
        type="button"
        className={`w-full flex items-center gap-3 sm:gap-4 pl-4 sm:pl-5 pr-4 py-3.5 text-left transition-colors ${
          expanded ? 'bg-teal-50/70 dark:bg-teal-950/40' : 'hover:bg-zinc-50/70 dark:hover:bg-zinc-700/30'
        }`}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        {/* Status indicators */}
        <span className="w-5 flex-shrink-0 flex flex-col items-center justify-center gap-1">
          {ds && <Microscope className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-label="Deep research completed" />}
          {shortlisted && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" aria-label="Shortlisted" />}
        </span>

        <span className="flex-1 min-w-0">
          <span className={`block text-sm font-medium leading-snug ${
            expanded ? 'text-teal-800 dark:text-teal-300' : 'text-zinc-900 dark:text-zinc-100'
          }`}>
            {grant.name}
          </span>
          <span className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {showFunder && (
              <span className="flex items-center gap-1.5 min-w-0">
                <Building2 className="w-3 h-3 shrink-0" aria-hidden />
                <span className="truncate">{grant.funder}</span>
              </span>
            )}
            {showFunder && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ${cfg.badge}`}>
                {grant.type}
              </span>
            )}
            {amount && <span className="tabular-nums">{amount}</span>}
            {deadline && (
              <span className="flex items-center gap-1">
                <CalendarDays className="w-3 h-3" aria-hidden />
                {deadline}
              </span>
            )}
            {!deadline && !amount && !showFunder && <span>Open / Rolling</span>}
          </span>
        </span>

        {/* Sub-scores — deep search recalibrated scores when available */}
        <SubScores scores={scores} className="hidden lg:flex" />
        <ScoreBadge score={scores?.overall} verified={!!ds} />
        <ChevronDown
          className={`w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {expanded && (
        <GrantDetail
          grant={grant}
          locale={locale}
          deepSearchState={deepSearchLoading === grant.id ? 'loading' : ds ? 'complete' : 'idle'}
          deepSearchData={ds}
          canDeepSearch={deepSearchLoading === null}
          onDeepSearch={() => onDeepSearch(grant)}
          isShortlisted={shortlisted}
          onToggleShortlist={() => onToggleShortlist(grant)}
        />
      )}
    </li>
  );
}

// ─── List view: every grant, best first ─────────────────────────────────────

const PAGE_SIZE = 40;

function GrantList({ grants, ...actions }: RowActions & { grants: GrantOpportunity[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);
  const visible = grants.slice(0, shown);

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-sm overflow-hidden">
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-700">
        {visible.map(grant => (
          <GrantRow
            key={grant.id}
            grant={grant}
            showFunder
            expanded={expandedId === grant.id}
            onToggle={() => setExpandedId(prev => (prev === grant.id ? null : grant.id))}
            {...actions}
          />
        ))}
      </ul>
      {grants.length > shown && (
        <button
          type="button"
          onClick={() => setShown(n => n + PAGE_SIZE)}
          className="w-full px-5 py-3 text-sm font-semibold text-teal-700 dark:text-teal-400 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 border-t border-zinc-100 dark:border-zinc-700 transition-colors"
        >
          Show {Math.min(PAGE_SIZE, grants.length - shown)} more ({grants.length - shown} remaining)
        </button>
      )}
    </div>
  );
}

// ─── Funder accordion ─────────────────────────────────────────────────────────

function FunderAccordion({ group, ...actions }: RowActions & { group: FunderGroup }) {
  const [open, setOpen] = useState(false);
  const [expandedGrantId, setExpandedGrantId] = useState<string | null>(null);
  const cfg = typeConfig(group.type);
  const panelId = `funder-${group.funder.replace(/\W+/g, '-')}`;

  const deepCount = group.grants.filter(g => actions.deepSearchData.has(g.id)).length;
  const shortlistCount = group.grants.filter(g => actions.shortlistedIds.has(g.id)).length;

  return (
    <li className={`bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 overflow-hidden shadow-sm border-l-4 ${cfg.border}`}>
      {/* Funder header */}
      <button
        type="button"
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-zinc-50/70 dark:hover:bg-zinc-700/30 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${cfg.icon}`}>
          <Building2 className="w-4 h-4" aria-hidden />
        </span>

        <span className="flex-1 min-w-0 flex items-center gap-2.5 flex-wrap">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">{group.funder}</span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ring-1 ${cfg.badge}`}>
            {group.type}
          </span>
          <span className="text-zinc-500 dark:text-zinc-400 text-xs">
            {group.grants.length} {group.grants.length === 1 ? 'programme' : 'programmes'}
          </span>
          {deepCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800">
              <Microscope className="w-3 h-3" aria-hidden />
              {deepCount} researched
            </span>
          )}
          {shortlistCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" aria-hidden />
              {shortlistCount} shortlisted
            </span>
          )}
        </span>

        <span className="flex items-center gap-4 flex-shrink-0">
          <span className="hidden sm:flex flex-col items-center">
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 mb-1">Best match</span>
            <ScoreRing score={group.bestScore} size={44} />
          </span>
          <ChevronDown
            className={`w-4 h-4 text-zinc-400 dark:text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </span>
      </button>

      {/* Grant programmes */}
      {open && (
        <ul id={panelId} className="border-t border-zinc-100 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
          {group.grants.map(grant => (
            <GrantRow
              key={grant.id}
              grant={grant}
              showFunder={false}
              expanded={expandedGrantId === grant.id}
              onToggle={() => setExpandedGrantId(prev => (prev === grant.id ? null : grant.id))}
              {...actions}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ─── Results page ─────────────────────────────────────────────────────────────

export default function ResultsPage() {
  return (
    <Suspense fallback={<ResultsLoading />}>
      <ResultsContent />
    </Suspense>
  );
}

function ResultsLoading({ label = 'Loading results…' }: { label?: string }) {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-canvas flex items-center justify-center" role="status">
      <div className="text-center">
        <div className="w-10 h-10 rounded-full bg-teal-50 dark:bg-teal-950 flex items-center justify-center mx-auto mb-4">
          <Search className="w-5 h-5 text-teal-600 dark:text-teal-400 animate-pulse" aria-hidden />
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 font-medium">{label}</p>
      </div>
    </div>
  );
}

function ResultsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [minScore, setMinScore] = useState(DEFAULT_MIN_SCORE);
  const [sortField, setSortField] = useState<SortField>('overall');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [view, setView] = useState<ViewMode>('grants');
  const [quickFilters, setQuickFilters] = useState<Set<QuickFilter>>(new Set());

  // Saved search context
  const [savedName, setSavedName] = useState<string | null>(null);

  // Deep search state: server data via SWR, plus results from this session so
  // they show immediately without waiting for a refetch.
  const { data: storedDeepSearches } = useDeepSearchMap();
  const [freshDeepSearches, setFreshDeepSearches] = useState<Map<string, DeepSearchResult>>(new Map());
  const [deepSearchLoading, setDeepSearchLoading] = useState<string | null>(null);
  const deepSearchData = useMemo(() => {
    const merged = new Map(storedDeepSearches ?? []);
    for (const [id, value] of freshDeepSearches) merged.set(id, value);
    return merged;
  }, [storedDeepSearches, freshDeepSearches]);

  // Shortlist state
  const [shortlistedIds, setShortlistedIds] = useState<Set<string>>(new Set());

  // Streaming search state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamProgress, setStreamProgress] = useState(0);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const searchStarted = useRef(false);

  // Abort the in-flight search when the user leaves the page, so the server
  // stops scoring. The timer survives React strict mode's mount → unmount →
  // mount in development: a real unmount fires it, a remount cancels it.
  const abortRef = useRef<AbortController | null>(null);
  const abortTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(abortTimer.current);
    return () => {
      abortTimer.current = setTimeout(() => abortRef.current?.abort(), 0);
    };
  }, []);

  // Animated progress for the initial wait before first batch completes
  const [animatedProgress, setAnimatedProgress] = useState(0);
  useEffect(() => {
    if (!isStreaming || streamProgress > 0) return;
    let p = 0;
    const interval = setInterval(() => {
      // Ease toward 20%, slowing as it approaches
      p = Math.min(p + (20 - p) * 0.04 + Math.random() * 0.3, 20);
      setAnimatedProgress(p);
    }, 800);
    return () => clearInterval(interval);
  }, [isStreaming, streamProgress]);

  useEffect(() => {
    async function runSearch() {
      // Guard against React strict mode double-invocation
      if (searchStarted.current) return;
      searchStarted.current = true;

      // Streaming mode: initiate search from stored form
      const formData = sessionStorage.getItem('grantSearchForm');
      if (!formData) { router.replace('/search'); return; }
      sessionStorage.removeItem('grantSearchForm');

      let form: OrgInfo;
      try { form = JSON.parse(formData); } catch { router.replace('/search'); return; }

      setIsStreaming(true);
      setStreamProgress(0);
      setResult({ grants: [], orgSummary: '', searchedAt: '', market: form.market || 'nz', inputs: form });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
          signal: controller.signal,
        });

        if (response.status === 401) {
          window.location.assign('/login');
          return;
        }
        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          throw new Error(
            response.status === 400
              ? 'Some of your search details were not accepted. Go back and check the website address and funding amount.'
              : data.error || 'The search could not be started. Please try again.',
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const allGrants: GrantOpportunity[] = [];
        let orgSummary = '';
        let searchedAt = '';
        let marketId = '';
        let partial = false;

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
                setStreamProgress(total > 0 ? completed / total : 0);
                break;
              }
              case 'grants': {
                allGrants.push(...(event.grants as GrantOpportunity[]));
                if (event.orgSummary) orgSummary = event.orgSummary as string;
                const completed = event.completed as number;
                const total = event.total as number;
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
                partial = event.incomplete === true;
                break;
              case 'error':
                throw new Error((event.message as string) || 'The search could not be completed.');
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
        setIncomplete(partial);
        setIsStreaming(false);

        // Save and update the URL so a refresh reloads this search
        const title = form.searchTitle?.trim() || '';
        setSavedName(title);
        const rerunId = sessionStorage.getItem('grantSearchRerunId');
        sessionStorage.removeItem('grantSearchRerunId');
        try {
          // A re-run replaces that search's results; if it has since been
          // deleted, fall back to saving a new one.
          const saved =
            (rerunId ? await updateSaved(rerunId, finalResult) : undefined)
            ?? await saveSearch(title, finalResult);
          setSavedName(saved.name);
          window.history.replaceState({}, '', `/results?saved=${saved.id}`);
        } catch (err) {
          toast.error(errorMessage(err, 'Your results are shown below but could not be saved.'));
        }
      } catch (err) {
        if (controller.signal.aborted) return; // user left the page
        console.error('Streaming search error:', err);
        setIsStreaming(false);
        setStreamError(errorMessage(err, 'The search could not be completed.'));
      }
    }

    async function loadSaved(id: string) {
      try {
        const saved = await getSaved(id);
        if (!saved) {
          toast.error('That search no longer exists.');
          router.replace('/saved');
          return;
        }
        setResult(saved.result);
        setSavedName(saved.name);
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) return;
        setStreamError(errorMessage(err, 'This search could not be loaded.'));
        setResult({ grants: [], orgSummary: '', searchedAt: '', market: 'nz' });
      }
    }

    if (searchParams.get('mode') === 'search') {
      void runSearch();
      return;
    }
    const id = searchParams.get('saved');
    if (id) void loadSaved(id);
    else router.replace('/saved');
  // Runs once on mount: the URL is rewritten in place after a search completes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hydrate shortlist stars once results are in
  const hasResults = !!result && !isStreaming && result.grants.length > 0;
  useEffect(() => {
    if (!hasResults) return;
    getAllShortlistedIds().then(setShortlistedIds).catch(() => { /* stars are non-critical */ });
  }, [hasResults]);

  const handleToggleShortlist = useCallback(async (grant: GrantOpportunity) => {
    // The saved name is unique per organisation and is what groups shortlisted
    // grants, so prefer it over the title typed into the form.
    const searchTitle = savedName || result?.inputs?.searchTitle || 'Untitled search';
    const wasShortlisted = shortlistedIds.has(grant.id);
    const setShortlisted = (shortlisted: boolean) =>
      setShortlistedIds(prev => {
        const next = new Set(prev);
        if (shortlisted) next.add(grant.id);
        else next.delete(grant.id);
        return next;
      });

    // Optimistic update — toggle UI immediately, roll back on failure
    setShortlisted(!wasShortlisted);
    try {
      if (wasShortlisted) await removeFromShortlist(grant.id);
      else await addToShortlist(grant, searchTitle);
    } catch (err) {
      setShortlisted(wasShortlisted);
      toast.error(errorMessage(err, 'Could not update your shortlist.'));
    }
  }, [result, savedName, shortlistedIds]);

  const handleDeepSearch = useCallback(async (grant: GrantOpportunity) => {
    if (deepSearchLoading) return;
    if (!result?.inputs) {
      toast.error('This search has no saved organisation details. Re-run the search to use Deep Search.');
      return;
    }
    setDeepSearchLoading(grant.id);
    try {
      const deepResult = await runDeepSearch(grant, result.inputs, result.market || 'nz');
      setFreshDeepSearches(prev => new Map(prev).set(grant.id, deepResult));
      toast.success(`Deep Search finished for ${grant.name}`);
    } catch (err) {
      toast.error(errorMessage(err, 'Deep Search failed. Please try again.'));
    } finally {
      setDeepSearchLoading(null);
    }
  }, [deepSearchLoading, result]);

  // Counts for the quick-filter chips, across the whole result set.
  const quickCounts = useMemo(() => {
    const grants = result?.grants ?? [];
    return {
      shortlisted: grants.filter(g => shortlistedIds.has(g.id)).length,
      researched: grants.filter(g => deepSearchData.has(g.id)).length,
      deadline: grants.filter(g => g.deadline || deepSearchData.get(g.id)?.applicationCloseDate).length,
    };
  }, [result, shortlistedIds, deepSearchData]);

  // Every grant that passes the filters, in the chosen order.
  const visibleGrants = useMemo((): GrantOpportunity[] => {
    if (!result) return [];
    // Deep-search-recalibrated scores when available, otherwise original scores
    const scoresOf = (g: GrantOpportunity) => deepSearchData.get(g.id)?.scores ?? g.scores;
    const deadlineOf = (g: GrantOpportunity) => deepSearchData.get(g.id)?.applicationCloseDate || g.deadline || '';

    let grants = result.grants.filter(g => scoresOf(g)?.overall !== undefined);

    const min = parseFloat(minScore);
    if (min > 0) grants = grants.filter(g => scoresOf(g).overall >= min);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      grants = grants.filter(g =>
        g.name.toLowerCase().includes(q) ||
        g.funder.toLowerCase().includes(q) ||
        (g.description || '').toLowerCase().includes(q)
      );
    }

    if (typeFilter !== 'all') grants = grants.filter(g => g.type === typeFilter);
    if (quickFilters.has('shortlisted')) grants = grants.filter(g => shortlistedIds.has(g.id));
    if (quickFilters.has('researched')) grants = grants.filter(g => deepSearchData.has(g.id));
    if (quickFilters.has('deadline')) grants = grants.filter(g => deadlineOf(g) !== '');

    const sortValue = (g: GrantOpportunity): number | string => {
      const s = scoresOf(g);
      switch (sortField) {
        case 'alignment': return s.alignment;
        case 'attainability': return s.attainability;
        case 'ease': return s.ease;
        // Grants with no deadline sort last whichever way the list runs.
        case 'deadline': return deadlineOf(g) || (sortDir === 'asc' ? '\uffff' : '');
        default: return s.overall;
      }
    };
    const direction = sortDir === 'asc' ? 1 : -1;

    return [...grants].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      if (av < bv) return -direction;
      if (av > bv) return direction;
      // Stable, meaningful tie-break: better overall score first.
      return scoresOf(b).overall - scoresOf(a).overall;
    });
  }, [result, searchQuery, typeFilter, sortField, sortDir, minScore, quickFilters, deepSearchData, shortlistedIds]);

  // The same grants grouped by funder; groups keep the order of their best grant.
  const funderGroups = useMemo((): FunderGroup[] => {
    const scoresOf = (g: GrantOpportunity) => deepSearchData.get(g.id)?.scores ?? g.scores;
    const byFunder = new Map<string, GrantOpportunity[]>();
    for (const g of visibleGrants) {
      const existing = byFunder.get(g.funder);
      if (existing) existing.push(g);
      else byFunder.set(g.funder, [g]);
    }
    return Array.from(byFunder.entries()).map(([funder, grants]) => ({
      funder,
      type: grants[0].type,
      grants,
      bestScore: Math.max(...grants.map(g => scoresOf(g)?.overall ?? 0)),
    }));
  }, [visibleGrants, deepSearchData]);

  if (!result) return <ResultsLoading />;

  const totalShown = visibleGrants.length;
  const market = getMarket(result.market ?? 'nz');
  const title = savedName || result.inputs?.searchTitle || 'Grant Opportunities';
  const filtersActive =
    searchQuery.trim() !== '' || typeFilter !== 'all' || minScore !== DEFAULT_MIN_SCORE || quickFilters.size > 0;
  const displayProgress = streamProgress > 0 ? streamProgress * 100 : animatedProgress;

  function resetFilters() {
    setSearchQuery('');
    setTypeFilter('all');
    setMinScore(DEFAULT_MIN_SCORE);
    setQuickFilters(new Set());
  }

  function toggleQuickFilter(filter: QuickFilter) {
    setQuickFilters(prev => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  }

  const rowActions = {
    locale: market.locale,
    deepSearchLoading,
    deepSearchData,
    onDeepSearch: handleDeepSearch,
    shortlistedIds,
    onToggleShortlist: handleToggleShortlist,
  };

  function handleExport() {
    const rows = visibleGrants.map(g => {
      const ds = deepSearchData.get(g.id);
      const s = ds?.scores ?? g.scores;
      return [
        g.name, g.funder, g.type,
        ds?.amountMin ?? g.amountMin, ds?.amountMax ?? g.amountMax,
        ds?.applicationCloseDate ?? g.deadline ?? '',
        s.overall, s.alignment, s.attainability, s.ease,
        shortlistedIds.has(g.id) ? 'Yes' : '',
        ds ? 'Yes' : '',
        g.url, g.alignmentReason,
      ];
    });
    downloadCsv(
      `${slugForFilename(title)}-grants.csv`,
      ['Grant', 'Funder', 'Type', 'Amount min', 'Amount max', 'Deadline', 'Overall', 'Alignment', 'Attainability', 'Ease', 'Shortlisted', 'Deep researched', 'URL', 'Why it fits'],
      rows,
    );
  }

  const cardClass = 'bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-sm';

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-canvas">
      {/* ── Page header ── */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5">
          <Link
            href="/saved"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors mb-4 group"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" aria-hidden />
            All searches
          </Link>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-display">{title}</h1>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 text-sm font-semibold px-3 py-1 rounded-full" aria-live="polite">
                  {isStreaming
                    ? `${result.grants.length} grants so far…`
                    : `${totalShown} grant${totalShown === 1 ? '' : 's'} · ${funderGroups.length} funder${funderGroups.length === 1 ? '' : 's'}`}
                </span>
                {!isStreaming && result.searchedAt && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-500">
                    Searched {new Date(result.searchedAt).toLocaleString(market.locale, {
                      day: 'numeric', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!isStreaming && totalShown > 0 && (
                <button
                  type="button"
                  onClick={handleExport}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-white dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700 text-zinc-700 dark:text-zinc-300 hover:ring-zinc-300 dark:hover:ring-zinc-600 transition-all"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden />
                  Export CSV
                </button>
              )}
              <Link
                href="/search"
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl ${PRIMARY_BUTTON_CLASS}`}
              >
                <Search className="w-3.5 h-3.5" aria-hidden />
                New Search
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* ── Streaming progress ── */}
        {isStreaming && (
          <div className={`${cardClass} p-5 border-l-4 border-l-teal-500`} role="status">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 className="w-4 h-4 animate-spin text-teal-600 dark:text-teal-400 flex-shrink-0" aria-hidden />
              <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                {streamProgress > 0 ? 'Scoring and ranking grants…' : 'Analysing grants…'}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-500 ml-auto tabular-nums">
                {Math.round(displayProgress)}%
              </span>
            </div>
            <div
              className="h-1.5 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden mb-3"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(displayProgress)}
              aria-label="Search progress"
            >
              <div
                className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${displayProgress}%` }}
              />
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {result.grants.length > 0
                ? `${result.grants.length} matching grant${result.grants.length === 1 ? '' : 's'} found so far — keep this page open`
                : 'Results appear as grants are scored. This usually takes a minute or two — keep this page open.'}
            </span>
          </div>
        )}

        {/* ── Search error ── */}
        {streamError && (
          <div role="alert" className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl px-5 py-4 shadow-sm">
            <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-1">Search failed</p>
            <p className="text-sm text-red-700 dark:text-red-300">{streamError}</p>
            <Link href="/search" className="inline-block mt-3 text-sm font-semibold text-red-800 dark:text-red-200 underline">
              Back to search
            </Link>
          </div>
        )}

        {/* ── Partial results notice ── */}
        {incomplete && (
          <div role="status" className="flex items-start gap-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-xl px-5 py-4">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" aria-hidden />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Some grants could not be scored this time, so this list may be missing matches.
              Re-run the search later for complete results.
            </p>
          </div>
        )}

        {/* ── Org summary ── */}
        {result.orgSummary && (
          <div className={`${cardClass} p-5 border-l-4 border-l-teal-500`}>
            <h2 className="text-xs font-semibold text-teal-700 dark:text-teal-400 uppercase tracking-wider mb-2">Organisation Summary</h2>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{result.orgSummary}</p>
          </div>
        )}

        {/* ── Filter toolbar ── */}
        <div className={`${cardClass} overflow-hidden sticky top-16 z-20`}>
          <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
            <div className="hidden sm:flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 font-medium mr-1">
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden />
              Filter &amp; sort
            </div>

            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" aria-hidden />
              <Input
                type="search"
                placeholder="Search grants or funders…"
                aria-label="Search grants or funders"
                className="pl-9 h-9 text-sm border-zinc-200 dark:border-zinc-700 focus-visible:ring-teal-500 bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-100"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            <Select value={typeFilter} onValueChange={v => setTypeFilter(v ?? 'all')}>
              <SelectTrigger aria-label="Filter by funder type" className="w-[140px] h-9 text-sm border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-100">
                <SelectValue placeholder="All types">
                  {typeFilter === 'all' ? 'All types' : typeFilter}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {GRANT_TYPES.map(type => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={minScore} onValueChange={v => setMinScore(v ?? DEFAULT_MIN_SCORE)}>
              <SelectTrigger aria-label="Minimum score" className="w-[130px] h-9 text-sm border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-100">
                <SelectValue>
                  {MIN_SCORE_OPTIONS.find(o => o.value === minScore)?.label ?? 'All scores'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MIN_SCORE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sortField} onValueChange={v => setSortField((v ?? 'overall') as SortField)}>
              <SelectTrigger aria-label="Sort by" className="w-[170px] h-9 text-sm border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-100">
                <SelectValue>
                  {SORT_OPTIONS.find(o => o.value === sortField)?.label ?? 'Sort'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Tooltip>
              <TooltipTrigger
                onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
                aria-label={`Sort direction: ${sortDir === 'asc' ? 'ascending' : 'descending'}. Click to reverse.`}
                className="h-9 w-9 flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-zinc-500 dark:text-zinc-400"
              >
                {sortDir === 'asc'
                  ? <ArrowUp className="w-3.5 h-3.5" aria-hidden />
                  : <ArrowDown className="w-3.5 h-3.5" aria-hidden />}
              </TooltipTrigger>
              <TooltipContent>{sortDir === 'asc' ? 'Ascending' : 'Descending'}</TooltipContent>
            </Tooltip>

            <span className="text-xs text-zinc-500 dark:text-zinc-500 ml-auto whitespace-nowrap tabular-nums">
              {totalShown} of {result.grants.length}
            </span>
          </div>

          {/* View switch + quick filters */}
          <div className="px-4 py-2.5 border-t border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/40 flex items-center gap-x-3 gap-y-2 flex-wrap">
            <div className="inline-flex rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-700 overflow-hidden" role="group" aria-label="View">
              {([
                { id: 'grants', label: 'Grants', icon: List },
                { id: 'funders', label: 'By funder', icon: Layers },
              ] as const).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setView(id)}
                  aria-pressed={view === id}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold transition-colors ${
                    view === id
                      ? 'bg-teal-600 text-white'
                      : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                  }`}
                >
                  <Icon className="w-3 h-3" aria-hidden />
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Quick filters">
              {([
                { id: 'shortlisted', label: 'Shortlisted', count: quickCounts.shortlisted },
                { id: 'researched', label: 'Researched', count: quickCounts.researched },
                { id: 'deadline', label: 'Has a deadline', count: quickCounts.deadline },
              ] as const).map(({ id, label, count }) => {
                const active = quickFilters.has(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleQuickFilter(id)}
                    aria-pressed={active}
                    disabled={count === 0 && !active}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ring-1 transition-colors disabled:opacity-40 ${
                      active
                        ? 'bg-teal-50 text-teal-800 ring-teal-300 dark:bg-teal-950 dark:text-teal-200 dark:ring-teal-700'
                        : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 ring-zinc-200 dark:ring-zinc-700 hover:ring-zinc-300 dark:hover:ring-zinc-600'
                    }`}
                  >
                    {label}
                    <span className="tabular-nums text-zinc-400 dark:text-zinc-500">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Score legend */}
            <div className="hidden md:flex items-center gap-x-3 ml-auto">
              {SCORE_BANDS.map(({ range, color, label }) => (
                <span key={range} className="flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400" title={label}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                  <span className="font-medium">{range}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Results ── */}
        {visibleGrants.length > 0 ? (
          view === 'grants' ? (
            <GrantList grants={visibleGrants} {...rowActions} />
          ) : (
            <ul className="space-y-3">
              {funderGroups.map(group => (
                <FunderAccordion key={group.funder} group={group} {...rowActions} />
              ))}
            </ul>
          )
        ) : !isStreaming && !streamError ? (
          <div className={`${cardClass} py-16 px-6 text-center`}>
            <Search className="w-8 h-8 mx-auto mb-3 text-zinc-300 dark:text-zinc-600" aria-hidden />
            {result.grants.length === 0 ? (
              <>
                <p className="font-semibold text-zinc-700 dark:text-zinc-200 text-sm">No matching grants found</p>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm mx-auto">
                  Try adding more sectors or regions, or describing your funding purpose more broadly.
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold text-zinc-700 dark:text-zinc-200 text-sm">No grants match your filters</p>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                  {result.grants.length} grant{result.grants.length === 1 ? ' is' : 's are'} hidden by the current filters.
                </p>
                {filtersActive ? (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="mt-4 inline-flex items-center px-4 py-2 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-colors"
                  >
                    Reset filters
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setMinScore('0')}
                    className="mt-4 inline-flex items-center px-4 py-2 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-colors"
                  >
                    Show all scores
                  </button>
                )}
              </>
            )}
          </div>
        ) : null}

        <p className="text-center text-xs text-zinc-500 dark:text-zinc-500 pt-2 pb-4">
          Scores are AI-generated estimates. Always verify grant details directly with funders before applying.
        </p>
      </div>
    </div>
  );
}
