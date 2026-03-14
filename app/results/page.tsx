'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, ArrowUp, ArrowDown, Search, ExternalLink,
  ChevronDown, ChevronUp, CalendarDays, Info, Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchResult, GrantOpportunity } from '@/lib/types';
import { getMarket } from '@/lib/markets';

type SortField = 'overall' | 'alignment' | 'attainability' | 'applicationDifficulty' | 'deadline';
type SortDir = 'asc' | 'desc';

interface FunderGroup {
  funder: string;
  type: GrantOpportunity['type'];
  grants: GrantOpportunity[];
  bestScore: number;
}

const TYPE_COLORS: Record<GrantOpportunity['type'], string> = {
  Government:    'bg-blue-100 text-blue-700 border-blue-200',
  Foundation:    'bg-purple-100 text-purple-700 border-purple-200',
  Corporate:     'bg-orange-100 text-orange-700 border-orange-200',
  Community:     'bg-green-100 text-green-700 border-green-200',
  International: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  Other:         'bg-slate-100 text-slate-600 border-slate-200',
};

function getScoreClass(score: number, invert = false): string {
  const v = invert ? 10 - score : score;
  if (v >= 9) return 'bg-emerald-700 text-white';
  if (v >= 7) return 'bg-green-500 text-white';
  if (v >= 5) return 'bg-yellow-400 text-slate-900';
  return 'bg-red-500 text-white';
}

function ScorePill({ score, invert = false, label }: { score: number; invert?: boolean; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${getScoreClass(score, invert)}`}>
      {label && <span className="font-normal opacity-75 text-[10px]">{label}</span>}
      {score.toFixed(1)}
    </span>
  );
}

function formatCurrency(n?: number) {
  if (!n) return '';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
}

function formatAmountRange(min?: number, max?: number) {
  if (!min && !max) return 'Varies';
  if (min && max) return `${formatCurrency(min)}–${formatCurrency(max)}`;
  if (max) return `Up to ${formatCurrency(max)}`;
  return `From ${formatCurrency(min)}`;
}

function formatDeadline(d?: string, locale = 'en-NZ') {
  if (!d) return 'Open / Rolling';
  try {
    return new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return d; }
}

function GrantDetail({ grant }: { grant: GrantOpportunity }) {
  return (
    <div className="bg-slate-50 border-t border-slate-200 px-5 py-5 grid grid-cols-1 md:grid-cols-3 gap-5 text-sm">
      <div>
        <h4 className="font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Description
        </h4>
        <p className="text-slate-600 leading-relaxed">{grant.description}</p>
        {!grant.url.includes('google.com/search') ? (
          <a href={grant.url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-3 text-blue-600 hover:text-blue-700 font-medium text-xs">
            View grant details <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <a href={grant.url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-3 text-slate-500 hover:text-slate-700 font-medium text-xs">
            Search for this grant <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      <div>
        <h4 className="font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" /> Alignment
        </h4>
        <p className="text-slate-600 leading-relaxed mb-4">{grant.alignmentReason}</p>
        <h4 className="font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" /> Application
        </h4>
        <p className="text-slate-600 leading-relaxed">{grant.applicationNotes}</p>
      </div>
      <div>
        <h4 className="font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-teal-500 inline-block" /> Attainability
        </h4>
        <p className="text-slate-600 leading-relaxed mb-4">{grant.attainabilityNotes}</p>
        <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Scores</p>
          <div className="flex justify-between items-center">
            <span className="text-slate-500 text-xs">Alignment</span>
            <ScorePill score={grant.scores.alignment} />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500 text-xs">Difficulty</span>
            <ScorePill score={grant.scores.applicationDifficulty} invert />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500 text-xs">Attainability</span>
            <ScorePill score={grant.scores.attainability} />
          </div>
          <div className="flex justify-between items-center border-t border-slate-100 pt-2">
            <span className="text-slate-700 text-xs font-semibold">Overall</span>
            <ScorePill score={grant.scores.overall} />
          </div>
        </div>
      </div>
    </div>
  );
}

function FunderAccordion({ group, defaultOpen = false, locale = 'en-NZ' }: { group: FunderGroup; defaultOpen?: boolean; locale?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const [expandedGrantId, setExpandedGrantId] = useState<string | null>(null);

  const toggleGrant = (id: string) =>
    setExpandedGrantId(prev => prev === id ? null : id);

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      {/* Funder header */}
      <button
        className="w-full flex items-center gap-3 px-5 py-4 bg-white hover:bg-slate-50 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
          <Building2 className="w-4 h-4 text-slate-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900">{group.funder}</span>
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${TYPE_COLORS[group.type]}`}>
              {group.type}
            </span>
            <span className="text-slate-400 text-xs">{group.grants.length} {group.grants.length === 1 ? 'program' : 'programs'}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="hidden sm:flex items-center gap-1 text-xs text-slate-500">
            Best score:
            <ScorePill score={group.bestScore} />
          </div>
          {open
            ? <ChevronUp className="w-4 h-4 text-slate-400" />
            : <ChevronDown className="w-4 h-4 text-slate-400" />
          }
        </div>
      </button>

      {/* Individual grant programs */}
      {open && (
        <div className="border-t border-slate-200 divide-y divide-slate-100">
          {group.grants.map(grant => {
            const isExpanded = expandedGrantId === grant.id;
            return (
              <div key={grant.id}>
                <button
                  className={`w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors
                    ${isExpanded ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'}`}
                  onClick={() => toggleGrant(grant.id)}
                >
                  {/* Grant name + meta */}
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium text-sm leading-tight ${isExpanded ? 'text-blue-700' : 'text-slate-800'}`}>
                      {grant.name}
                    </p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-slate-400 text-xs">{formatAmountRange(grant.amountMin, grant.amountMax)}</span>
                      <span className="flex items-center gap-1 text-slate-400 text-xs">
                        <CalendarDays className="w-3 h-3" />
                        {formatDeadline(grant.deadline, locale)}
                      </span>
                    </div>
                  </div>
                  {/* Scores */}
                  <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                    <ScorePill score={grant.scores.alignment} label="Align" />
                    <ScorePill score={grant.scores.applicationDifficulty} invert label="Diff" />
                    <ScorePill score={grant.scores.attainability} label="Attain" />
                  </div>
                  <div className="flex-shrink-0 ml-2">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-bold ${getScoreClass(grant.scores.overall)}`}>
                      {grant.scores.overall.toFixed(1)}
                    </span>
                  </div>
                  <div className="text-slate-400 flex-shrink-0 ml-1">
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </div>
                </button>
                {isExpanded && <GrantDetail grant={grant} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ResultsPage() {
  const router = useRouter();
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [minScore, setMinScore] = useState('5');
  const [sortField, setSortField] = useState<SortField>('overall');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    const stored = sessionStorage.getItem('grantSearchResult');
    if (!stored) { router.replace('/'); return; }
    try { setResult(JSON.parse(stored)); }
    catch { router.replace('/'); }
  }, [router]);

  const funderGroups = useMemo((): FunderGroup[] => {
    if (!result) return [];
    // Drop any grants that came back without scores (malformed API response)
    let grants = result.grants.filter(g => g.scores?.overall !== undefined);

    // Apply minimum score filter
    const min = parseFloat(minScore);
    if (min > 0) grants = grants.filter(g => g.scores.overall >= min);

    // Apply text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      grants = grants.filter(g =>
        g.name.toLowerCase().includes(q) ||
        g.funder.toLowerCase().includes(q) ||
        g.description.toLowerCase().includes(q)
      );
    }

    // Apply type filter
    if (typeFilter !== 'all') {
      grants = grants.filter(g => g.type === typeFilter);
    }

    // Group by funder
    const map = new Map<string, GrantOpportunity[]>();
    for (const g of grants) {
      const existing = map.get(g.funder) || [];
      existing.push(g);
      map.set(g.funder, existing);
    }

    // Build groups, sort grants within each funder
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

    // Sort funder groups by best score (or other criteria)
    return groups.sort((a, b) => {
      if (sortField === 'deadline') {
        const aMin = a.grants[0]?.deadline || 'ZZZ';
        const bMin = b.grants[0]?.deadline || 'ZZZ';
        return sortDir === 'asc' ? aMin.localeCompare(bMin) : bMin.localeCompare(aMin);
      }
      return sortDir === 'asc' ? a.bestScore - b.bestScore : b.bestScore - a.bestScore;
    });
  }, [result, searchQuery, typeFilter, sortField, sortDir]);

  const totalShown = funderGroups.reduce((sum, g) => sum + g.grants.length, 0);
  const market = result ? getMarket(result.market ?? 'nz') : null;

  if (!result) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500">Loading results...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <Button variant="ghost" size="sm" onClick={() => router.push('/')}
              className="mb-3 text-slate-500 hover:text-slate-700 -ml-2">
              <ArrowLeft className="w-4 h-4 mr-1" /> New Search
            </Button>
            <h1 className="text-2xl font-bold text-slate-900">Grant Opportunities Found</h1>
            <div className="flex items-center gap-3 mt-1.5 text-sm text-slate-500 flex-wrap">
              <span className="bg-blue-100 text-blue-700 font-semibold px-2.5 py-0.5 rounded-full">
                {totalShown} grants across {funderGroups.length} funders
              </span>
              <span className="flex items-center gap-1">
                <CalendarDays className="w-3.5 h-3.5" />
                {new Date(result.searchedAt).toLocaleString(market?.locale ?? 'en-NZ', {
                  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
          </div>
          <Button onClick={() => router.push('/')}
            className="bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 text-white">
            <Search className="w-4 h-4 mr-2" /> New Search
          </Button>
        </div>

        {/* Org Summary */}
        {result.orgSummary && (
          <Card className="mb-6 border-blue-100 bg-blue-50/50">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-semibold text-blue-700 flex items-center gap-1.5">
                <Info className="w-4 h-4" /> Organisation Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <p className="text-slate-700 text-sm leading-relaxed">{result.orgSummary}</p>
            </CardContent>
          </Card>
        )}

        {/* Toolbar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 flex flex-wrap gap-3 items-center shadow-sm">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Search grants or funders..." className="pl-9"
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>

          <Select value={typeFilter} onValueChange={v => setTypeFilter(v ?? 'all')}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="Government">Government</SelectItem>
              <SelectItem value="Foundation">Foundation</SelectItem>
              <SelectItem value="Corporate">Corporate</SelectItem>
              <SelectItem value="Community">Community</SelectItem>
              <SelectItem value="International">International</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
            </SelectContent>
          </Select>

          <Select value={minScore} onValueChange={v => setMinScore(v ?? '5')}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Min score" />
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
            <SelectTrigger className="w-[190px]">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="overall">Overall Score</SelectItem>
              <SelectItem value="alignment">Alignment</SelectItem>
              <SelectItem value="attainability">Attainability</SelectItem>
              <SelectItem value="applicationDifficulty">Difficulty</SelectItem>
              <SelectItem value="deadline">Deadline</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="icon"
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}>
            {sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
          </Button>

          <span className="text-slate-400 text-sm ml-auto whitespace-nowrap">
            {totalShown} of {result.grants.length} shown
          </span>
        </div>

        {/* Score legend */}
        <div className="flex items-center gap-4 mb-4 px-1 flex-wrap">
          <span className="text-xs text-slate-400 font-medium">Overall score:</span>
          {[['9–10', 'bg-emerald-700 text-white'], ['7–8', 'bg-green-500 text-white'], ['5–6', 'bg-yellow-400 text-slate-900'], ['0–4', 'bg-red-500 text-white']].map(([label, cls]) => (
            <span key={label} className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className={`inline-block w-4 h-4 rounded-full ${cls}`} /> {label}
            </span>
          ))}
        </div>

        {/* Results */}
        {funderGroups.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 py-16 text-center text-slate-400 shadow-sm">
            <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No grants match your filters</p>
            <p className="text-sm mt-1">Try clearing the search or changing the type filter</p>
          </div>
        ) : (
          <div className="space-y-3">
            {funderGroups.map((group, i) => (
              <FunderAccordion key={group.funder} group={group} defaultOpen={i === 0} locale={market?.locale} />
            ))}
          </div>
        )}

        <p className="text-center text-slate-400 text-xs mt-6">
          Scores are AI-generated estimates. Always verify grant details directly with funders before applying.
        </p>
      </div>
    </div>
  );
}
