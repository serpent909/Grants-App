'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ArrowUp, ArrowDown, Search, ExternalLink,
  ChevronDown, ChevronUp, CalendarDays, Building2,
  SlidersHorizontal, Bookmark, BookmarkCheck, X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchResult, GrantOpportunity } from '@/lib/types';
import { getMarket } from '@/lib/markets';
import { saveSearch, updateSaved, autoName, getSaved } from '@/lib/saved-searches';

// ─── Types ────────────────────────────────────────────────────────────────────

type SortField = 'overall' | 'alignment' | 'attainability' | 'applicationDifficulty' | 'deadline';
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

function scoreColor(score: number, invert = false): string {
  const v = invert ? 10 - score : score;
  if (v >= 8) return '#10b981';  // emerald
  if (v >= 6.5) return '#f59e0b'; // amber
  if (v >= 5) return '#f97316';   // orange
  return '#ef4444';               // red
}

function scoreTextClass(score: number, invert = false): string {
  const v = invert ? 10 - score : score;
  if (v >= 8) return 'text-emerald-700 bg-emerald-50';
  if (v >= 6.5) return 'text-amber-700 bg-amber-50';
  if (v >= 5) return 'text-orange-600 bg-orange-50';
  return 'text-red-600 bg-red-50';
}

// ─── Score ring ───────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const strokeW = 4;
  const r = (size - strokeW * 2) / 2;
  const circ = 2 * Math.PI * r;
  const arc = Math.max(0, Math.min(1, score / 10)) * circ;
  const color = scoreColor(score);

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
          {score.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

// ─── Score pill ───────────────────────────────────────────────────────────────

function ScorePill({ score, invert = false, label }: { score: number; invert?: boolean; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md tabular-nums ${scoreTextClass(score, invert)}`}>
        {score.toFixed(1)}
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

function GrantDetail({ grant, locale }: { grant: GrantOpportunity; locale: string }) {
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
                { label: 'Alignment', score: grant.scores.alignment, invert: false },
                { label: 'Difficulty', score: grant.scores.applicationDifficulty, invert: true },
                { label: 'Attainability', score: grant.scores.attainability, invert: false },
              ].map(({ label, score, invert }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">{label}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${(invert ? 10 - score : score) * 10}%`,
                          backgroundColor: scoreColor(score, invert),
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
                  {grant.scores.overall.toFixed(1)}
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
}: {
  group: FunderGroup;
  defaultOpen?: boolean;
  locale?: string;
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
          {group.grants.map(grant => {
            const isExpanded = expandedGrantId === grant.id;
            const deadline = formatDeadline(grant.deadline, locale);
            const amount = formatAmountRange(grant.amountMin, grant.amountMax);

            return (
              <div key={grant.id}>
                <button
                  className={`w-full flex items-center gap-4 pl-5 pr-4 py-3.5 text-left transition-colors ${
                    isExpanded ? 'bg-indigo-50/60' : 'bg-white hover:bg-zinc-50/70'
                  }`}
                  onClick={() => toggleGrant(grant.id)}
                >
                  {/* Left spacer to align with funder header content */}
                  <div className="w-9 flex-shrink-0" />

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
                    <ScorePill score={grant.scores.applicationDifficulty} invert label="Ease" />
                    <ScorePill score={grant.scores.attainability} label="Win" />
                  </div>

                  {/* Overall score */}
                  <div className="flex-shrink-0 ml-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm text-white tabular-nums"
                      style={{ backgroundColor: scoreColor(grant.scores.overall) }}
                    >
                      {grant.scores.overall.toFixed(1)}
                    </div>
                  </div>

                  <div className="text-zinc-400 flex-shrink-0">
                    {isExpanded
                      ? <ChevronUp className="w-3.5 h-3.5" />
                      : <ChevronDown className="w-3.5 h-3.5" />
                    }
                  </div>
                </button>

                {isExpanded && <GrantDetail grant={grant} locale={locale} />}
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [minScore, setMinScore] = useState('5');
  const [sortField, setSortField] = useState<SortField>('overall');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Save state
  const [savedId, setSavedId] = useState<string | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState('');
  const saveInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check if loading a saved search by ID
    const id = searchParams.get('saved');
    if (id) {
      const saved = getSaved(id);
      if (saved) {
        setResult(saved.result);
        setSavedId(id);
        return;
      }
    }
    const stored = sessionStorage.getItem('grantSearchResult');
    if (!stored) { router.replace('/'); return; }
    try { setResult(JSON.parse(stored)); }
    catch { router.replace('/'); }
  }, [router, searchParams]);

  function handleSaveClick() {
    if (!result) return;
    setSaveName(autoName(result));
    setShowSaveForm(true);
    setTimeout(() => saveInputRef.current?.select(), 50);
  }

  function handleSaveConfirm() {
    if (!result) return;
    if (savedId) {
      updateSaved(savedId, result);
    } else {
      const entry = saveSearch(saveName, result);
      setSavedId(entry.id);
      router.replace(`/results?saved=${entry.id}`, { scroll: false });
    }
    setShowSaveForm(false);
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
          case 'applicationDifficulty': av = a.scores.applicationDifficulty; bv = b.scores.applicationDifficulty; break;
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
                {savedId ? (getSaved(savedId)?.name ?? 'Grant Opportunities') : 'Grant Opportunities'}
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

            <div className="flex items-center gap-2">
              {/* Save */}
              {!showSaveForm ? (
                <button
                  onClick={handleSaveClick}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl border transition-all ${
                    savedId
                      ? 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100'
                      : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300'
                  }`}
                >
                  {savedId
                    ? <><BookmarkCheck className="w-3.5 h-3.5" /> Saved</>
                    : <><Bookmark className="w-3.5 h-3.5" /> Save</>
                  }
                </button>
              ) : (
                <div className="flex items-center gap-2 bg-white border border-teal-300 rounded-xl px-3 py-1.5 shadow-sm">
                  <Bookmark className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                  <input
                    ref={saveInputRef}
                    type="text"
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveConfirm(); if (e.key === 'Escape') setShowSaveForm(false); }}
                    className="text-sm text-zinc-800 bg-transparent outline-none w-52"
                    placeholder="Name this search..."
                  />
                  <button
                    onClick={handleSaveConfirm}
                    className="text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 px-2.5 py-1 rounded-lg transition-colors"
                  >
                    Save
                  </button>
                  <button onClick={() => setShowSaveForm(false)} className="text-zinc-400 hover:text-zinc-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

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
                <SelectItem value="applicationDifficulty">Sort: Easiest first</SelectItem>
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
              />
            ))}
          </div>
        )}

        <p className="text-center text-xs text-zinc-400 pt-2 pb-4">
          Scores are AI-generated estimates. Always verify grant details directly with funders before applying.
        </p>
      </div>
    </div>
  );
}
