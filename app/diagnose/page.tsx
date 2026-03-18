'use client';

import { useState, useCallback } from 'react';
import { Globe, DollarSign, Linkedin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { listMarkets } from '@/lib/markets';
import { useSavedSearches, type SavedSearch } from '@/lib/saved-searches';
import type { OrgInfo } from '@/lib/types';
import type { DiagnoseResponse, DiagnoseFunderResult } from '@/app/api/diagnose/route';
import { SECTORS, ORG_TYPES } from '@/lib/constants';
import { TogglePill } from '@/components/toggle-pill';
import { Field } from '@/components/field';

const MARKETS = listMarkets();

const STAGE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  enumeration:      { label: 'Missed in enumeration',       color: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-200' },
  search:           { label: 'Enumerated but not found',    color: 'text-orange-700',  bg: 'bg-orange-50',  border: 'border-orange-200' },
  extraction:       { label: 'Found but not extracted',     color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200' },
  'gpt-extraction': { label: 'Extracted but GPT missed',   color: 'text-yellow-700',  bg: 'bg-yellow-50',  border: 'border-yellow-200' },
  none:             { label: 'Should appear — pipeline OK', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  unknown:          { label: 'Could not diagnose',          color: 'text-zinc-600',    bg: 'bg-zinc-50',    border: 'border-zinc-200' },
};

export default function DiagnosePage() {
  const { data: savedSearches = [] } = useSavedSearches();
  const [selectedSavedId, setSelectedSavedId] = useState('');
  const [form, setForm] = useState<OrgInfo>({
    website: '',
    linkedin: '',
    fundingPurpose: '',
    fundingAmount: 0,
    market: 'nz',
    regions: [],
    sectors: [],
    orgType: '',
    previousFunders: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof OrgInfo, string>>>({});
  const [expectedFunders, setExpectedFunders] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagnoseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEnumList, setShowEnumList] = useState(false);

  const activeMarket = MARKETS.find(m => m.id === form.market) ?? MARKETS[0];

  function handleLoadSaved(id: string | null) {
    setSelectedSavedId(id ?? '');
    if (!id) return;
    const saved = savedSearches.find(s => s.id === id);
    if (!saved?.result.inputs) return;
    setForm({ ...saved.result.inputs });
    setErrors({});
  }

  const updateField = useCallback(<K extends keyof OrgInfo>(key: K, value: OrgInfo[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }));
  }, [errors]);

  const toggleArrayItem = useCallback((key: 'regions' | 'sectors', id: string) => {
    setForm(prev => {
      const arr = prev[key];
      const next = arr.includes(id) ? arr.filter(v => v !== id) : [...arr, id];
      return { ...prev, [key]: next };
    });
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }));
  }, [errors]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const newErrors: Partial<Record<keyof OrgInfo, string>> = {};
    if (!form.website.trim()) newErrors.website = 'Website URL is required';
    if (!form.fundingPurpose.trim()) newErrors.fundingPurpose = 'Funding purpose is required';
    if (form.regions.length === 0) newErrors.regions = 'Please select at least one region';
    if (form.sectors.length === 0) newErrors.sectors = 'Please select at least one sector';
    if (!form.orgType) newErrors.orgType = 'Please select organisation type';
    if (!expectedFunders.trim()) {
      setError('Please enter at least one expected funder');
      return;
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    setResult(null);
    setError(null);

    const parsedFunders = expectedFunders
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [name, url] = line.split('|').map(s => s.trim());
        return { name, url: url || undefined };
      });

    try {
      const res = await fetch('/api/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          expectedFunders: parsedFunders,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Request failed ${res.status}`);
      }
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f5f0] py-10 px-6">
      <div className="max-w-xl mx-auto">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-900">Search Pipeline Diagnostics</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Runs a lightweight analysis (~$0.05–0.15) to identify exactly why specific funders
            are missing from search results — without running the full pipeline.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl shadow-stone-200/60 ring-1 ring-stone-200 overflow-hidden">
          <div className="px-7 pt-7 pb-5 border-b border-zinc-100">
            <h2 className="text-base font-semibold text-zinc-900">About your organisation</h2>
            <p className="text-sm text-zinc-500 mt-0.5">Fill in the same details you used in your search.</p>
          </div>

          <form onSubmit={handleSubmit} className="px-7 py-6 space-y-5">

            {/* Load from saved search */}
            {savedSearches.length > 0 && (
              <div className="pb-5 border-b border-zinc-100">
                <Field label="Load from saved search">
                  <Select value={selectedSavedId} onValueChange={handleLoadSaved}>
                    <SelectTrigger className="h-10 border-zinc-200 focus:ring-teal-500 focus:border-teal-500">
                      <SelectValue placeholder="— select a saved search to pre-fill —" />
                    </SelectTrigger>
                    <SelectContent>
                      {savedSearches.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} ({s.grantCount} grants · {new Date(s.savedAt).toLocaleDateString()})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedSavedId && !savedSearches.find(s => s.id === selectedSavedId)?.result.inputs && (
                    <p className="text-xs text-amber-600 mt-1">
                      This saved search was created before inputs were stored — fields could not be pre-filled.
                    </p>
                  )}
                </Field>
              </div>
            )}

            {/* Country */}
            <Field label="Country" required>
              <Select
                value={form.market}
                onValueChange={v => {
                  if (v) setForm(prev => ({ ...prev, market: v, regions: [] }));
                }}
              >
                <SelectTrigger className="h-10 border-zinc-200 focus:ring-teal-500 focus:border-teal-500">
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  {MARKETS.map(m => <SelectItem key={m.id} value={m.id}>{m.displayName}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>

            {/* Operating Regions */}
            <Field
              label="Operating regions"
              required
              error={errors.regions}
              hint="Select the regions where your organisation operates. National funders are always included."
            >
              <div className="flex flex-wrap gap-2">
                {activeMarket.regions.map(r => (
                  <TogglePill
                    key={r.id}
                    label={r.name}
                    selected={form.regions.includes(r.id)}
                    onToggle={() => toggleArrayItem('regions', r.id)}
                  />
                ))}
              </div>
            </Field>

            {/* Organisation Type */}
            <Field label="Organisation type" required error={errors.orgType}>
              <Select value={form.orgType} onValueChange={v => v && updateField('orgType', v)}>
                <SelectTrigger className="h-10 border-zinc-200 focus:ring-teal-500 focus:border-teal-500">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {ORG_TYPES.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>

            {/* Website */}
            <Field label="Organisation website" required error={errors.website}>
              <div className="relative">
                <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <Input
                  type="url"
                  placeholder="https://yourorg.org"
                  className={`pl-10 h-10 border-zinc-200 focus-visible:ring-teal-500 focus-visible:border-teal-500 ${
                    errors.website ? 'border-red-300 focus-visible:ring-red-400' : ''
                  }`}
                  value={form.website}
                  onChange={e => updateField('website', e.target.value)}
                />
              </div>
            </Field>

            {/* LinkedIn (optional) */}
            <Field label="LinkedIn page" hint="Optional — helps us understand your organisation better">
              <div className="relative">
                <Linkedin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <Input
                  type="url"
                  placeholder="https://linkedin.com/company/your-org"
                  className="pl-10 h-10 border-zinc-200 focus-visible:ring-teal-500"
                  value={form.linkedin}
                  onChange={e => updateField('linkedin', e.target.value)}
                />
              </div>
            </Field>

            {/* Sectors */}
            <Field
              label="Sector / focus areas"
              required
              error={errors.sectors}
              hint="Select all that apply to your organisation"
            >
              <div className="flex flex-wrap gap-2">
                {SECTORS.map(s => (
                  <TogglePill
                    key={s.id}
                    label={s.label}
                    selected={form.sectors.includes(s.id)}
                    onToggle={() => toggleArrayItem('sectors', s.id)}
                  />
                ))}
              </div>
            </Field>

            {/* Funding Purpose */}
            <Field
              label="What is this funding search for?"
              required
              error={errors.fundingPurpose}
              hint={`${form.fundingPurpose.length} characters — the more detail, the better`}
            >
              <textarea
                rows={3}
                placeholder="Describe what you need funding for. Include your target population, specific activities, and any relevant context..."
                className={`w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none transition-shadow ${
                  errors.fundingPurpose ? 'border-red-300 focus:ring-red-400' : 'border-zinc-200'
                }`}
                value={form.fundingPurpose}
                onChange={e => updateField('fundingPurpose', e.target.value)}
              />
            </Field>

            {/* Funding Amount */}
            <Field label={`Funding amount sought (${activeMarket.currency})`} required error={errors.fundingAmount}>
              <div className="relative">
                <DollarSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <Input
                  type="number"
                  placeholder="50000"
                  min={1}
                  className={`pl-10 h-10 border-zinc-200 focus-visible:ring-teal-500 ${
                    errors.fundingAmount ? 'border-red-300 focus-visible:ring-red-400' : ''
                  }`}
                  value={form.fundingAmount || ''}
                  onChange={e => updateField('fundingAmount', parseFloat(e.target.value) || 0)}
                />
              </div>
            </Field>

            {/* Previous Funders */}
            <Field label="Previous or current funders" hint="Optional — helps us find similar funding sources">
              <textarea
                rows={2}
                placeholder="e.g. Lion Foundation, Otago Community Trust, DIA Community Organisation Grants..."
                className="w-full rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none transition-shadow"
                value={form.previousFunders}
                onChange={e => updateField('previousFunders', e.target.value)}
              />
            </Field>

            {/* Expected but missing funders — unique to diagnostics */}
            <div className="pt-2 border-t border-zinc-100">
              <Field
                label="Expected but missing funders"
                required
                hint="One per line — Name | https://optional-url"
              >
                <textarea
                  rows={6}
                  value={expectedFunders}
                  onChange={e => setExpectedFunders(e.target.value)}
                  placeholder={`Otago Community Trust | https://www.oct.org.nz/funding/apply-for-funding\nWright Family Foundation\nRural Communities Trust | https://www.ruralcommunitiestrust.org.nz/grants`}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-sm font-mono text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none transition-shadow"
                />
              </Field>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 disabled:from-zinc-300 disabled:to-zinc-300 text-white font-semibold text-sm rounded-xl transition-all duration-200 active:scale-[0.99]"
            >
              {loading ? 'Running diagnostics…' : 'Run Diagnostics'}
            </button>
          </form>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mt-6 text-sm">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-6 mt-8">
            {/* Summary */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-zinc-900">Enumeration Summary</h2>
                <span className="text-xs text-zinc-400">{(result.durationMs / 1000).toFixed(1)}s</span>
              </div>
              <p className="text-sm text-zinc-600 mb-3">
                GPT enumerated <strong>{result.enumeratedCount} funders</strong> for {result.market}.
              </p>
              <button
                type="button"
                onClick={() => setShowEnumList(!showEnumList)}
                className="text-xs text-teal-600 hover:underline"
              >
                {showEnumList ? 'Hide' : 'Show'} full enumerated list
              </button>
              {showEnumList && (
                <div className="mt-3 max-h-48 overflow-y-auto text-xs text-zinc-500 font-mono bg-zinc-50 rounded-lg p-3 leading-relaxed">
                  {result.enumeratedFunders.map((f, i) => <div key={i}>{f}</div>)}
                </div>
              )}
            </div>

            {/* Per-funder results */}
            <h2 className="font-semibold text-zinc-900">Funder Diagnoses</h2>
            {result.results.map((r, i) => <FunderCard key={i} result={r} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function FunderCard({ result }: { result: DiagnoseFunderResult }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STAGE_CONFIG[result.failureStage] ?? STAGE_CONFIG.unknown;

  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
              {cfg.label}
            </span>
          </div>
          <h3 className="font-semibold text-zinc-900">{result.name}</h3>
          <p className="text-sm text-zinc-600 mt-1">{result.diagnosis}</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-zinc-400 hover:text-zinc-600 shrink-0 mt-1"
        >
          {expanded ? 'less' : 'details'}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 text-xs">
          <Row label="Was enumerated" value={result.wasEnumerated ? `Yes — as "${result.enumeratedAs}"` : 'No'} />
          {result.enumeratedSearchQuery && (
            <Row label="Search query used" value={result.enumeratedSearchQuery} mono />
          )}
          <Row label="Tavily search results" value={
            result.searchUrls.length ? result.searchUrls.slice(0, 3).join('\n') : 'No results'
          } mono={result.searchUrls.length > 0} />
          <Row label="URL tested for extraction" value={result.testedUrl || 'None'} mono={!!result.testedUrl} />
          <Row label="Extraction status" value={result.extractionStatus} />
          {result.extractedSnippet && (
            <Row label="Extracted content (first 400 chars)" value={result.extractedSnippet} mono />
          )}
          {result.gptFoundGrants !== undefined && (
            <Row
              label="GPT found grants"
              value={result.gptFoundGrants
                ? `Yes — ${result.gptGrantNames?.join(', ') || 'unnamed'}`
                : `No — ${result.gptReason}`}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="font-medium text-zinc-500">{label}: </span>
      <span className={`text-zinc-700 ${mono ? 'font-mono break-all' : ''}`}>{value}</span>
    </div>
  );
}
