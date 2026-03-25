'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Globe, Linkedin, DollarSign,
  AlertCircle, ArrowRight, Bookmark, Search,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { OrgInfo } from '@/lib/types';
import { getMarket } from '@/lib/markets';
import { useSavedSearches } from '@/lib/saved-searches';
import { SECTORS, ORG_TYPES } from '@/lib/constants';
import { TogglePill } from '@/components/toggle-pill';
import { Field } from '@/components/field';

const activeMarket = getMarket('nz');

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ─── Saved searches link ──────────────────────────────────────────────────────

function SavedSearchesLink() {
  const router = useRouter();
  const { data: saved } = useSavedSearches();
  const count = saved?.length ?? 0;
  return (
    <div className="h-10 flex items-center justify-center">
      {count > 0 && (
        <button
          onClick={() => router.push('/saved')}
          className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white text-sm font-medium px-4 py-2 rounded-xl transition-all"
        >
          <Bookmark className="w-3.5 h-3.5" />
          Funding searches ({count})
          <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const [form, setForm] = useState<OrgInfo>({
    searchTitle: '',
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
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('grantSearchPrefill');
    if (raw) {
      sessionStorage.removeItem('grantSearchPrefill');
      try {
        const inputs = JSON.parse(raw);
        setForm(inputs);
      } catch { /* ignore malformed data */ }
    }
  }, []);

  const validate = useCallback((): boolean => {
    const newErrors: Partial<Record<keyof OrgInfo, string>> = {};
    if (!form.searchTitle?.trim()) {
      newErrors.searchTitle = 'Please give this search a title';
    }
    if (!form.website.trim()) {
      newErrors.website = 'Website URL is required';
    } else if (!isValidUrl(form.website)) {
      newErrors.website = 'Please enter a valid URL (e.g. https://yourorg.org)';
    }
    if (form.linkedin.trim() && !isValidUrl(form.linkedin)) {
      newErrors.linkedin = 'Please enter a valid LinkedIn URL';
    }
    if (!form.fundingPurpose.trim()) {
      newErrors.fundingPurpose = 'Please describe what this funding is for';
    } else if (form.fundingPurpose.trim().length < 20) {
      newErrors.fundingPurpose = 'Please provide more detail (at least 20 characters)';
    }
    if (!form.fundingAmount || form.fundingAmount <= 0) {
      newErrors.fundingAmount = 'Please enter the funding amount you are seeking';
    }
    if (form.regions.length === 0) {
      newErrors.regions = 'Please select at least one operating region';
    }
    if (form.sectors.length === 0) {
      newErrors.sectors = 'Please select at least one sector';
    }
    if (!form.orgType) {
      newErrors.orgType = 'Please select your organisation type';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [form]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    if (!validate()) return;

    setIsLoading(true);
    // Store form for the results page to consume via streaming
    sessionStorage.setItem('grantSearchForm', JSON.stringify(form));
    router.push('/results?mode=search');
  }, [form, validate, router]);

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

  return (
    <div className="min-h-screen bg-zinc-900">
      {/* ── Centered vertical layout ── */}
      <div className="relative px-4 sm:px-6 py-12 sm:py-16">

        {/* Soft teal glow — top centre */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(20,184,166,0.10),transparent)]" />

        <div className="relative max-w-3xl mx-auto">

          {/* ── Hero copy ── */}
          <div className="text-center mb-10">
            <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight leading-tight mb-5">
              <span className="block text-zinc-400 text-2xl sm:text-3xl font-medium mb-2 tracking-normal">
                Grant funding search for
              </span>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-emerald-400">
                New Zealand
              </span>
              <span className="text-white"> organisations</span>
            </h1>

            <p className="text-zinc-400 text-base leading-relaxed mb-8 max-w-sm mx-auto">
              Tell us about your organisation and what you need funding for.
              We&apos;ll find and rank the grants most likely to be a good fit —
              saving you hours of research.
            </p>

            <div className="flex items-center justify-center gap-6 sm:gap-10 mb-4">
              {[
                ['200+', 'Funding sources'],
                ['Matched', 'To your mission'],
                ['Ranked', 'By fit & likelihood'],
              ].map(([stat, label]) => (
                <div key={stat} className="text-center">
                  <div className="text-base font-bold text-white font-display">{stat}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            <SavedSearchesLink />
          </div>

          {/* ── Form card ── */}
          <div className="bg-white rounded-2xl shadow-2xl shadow-black/20 ring-1 ring-zinc-200 overflow-hidden">
            {!isLoading && (
              <div className="px-5 sm:px-8 pt-7 pb-5 bg-zinc-50/70 border-b border-zinc-200/60">
                <h2 className="text-xl font-bold text-zinc-900 font-display">
                  About your organisation
                </h2>
                <p className="text-sm text-zinc-500 mt-1">
                  The more context you share, the better we can match you with the right funding.
                </p>
              </div>
            )}

            {isLoading ? (
              <div className="px-5 sm:px-8 py-16 flex flex-col items-center">
                <div className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center mb-4">
                  <Search className="w-5 h-5 text-teal-600 animate-pulse" />
                </div>
                <p className="text-sm font-medium text-zinc-700">Starting search...</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="divide-y divide-zinc-100">
                {apiError && (
                  <div className="px-5 sm:px-8 pt-6">
                    <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <p className="text-sm leading-relaxed">{apiError}</p>
                    </div>
                  </div>
                )}

                {/* ── Section 1: Identity ── */}
                <div className="px-5 sm:px-8 py-6 space-y-4">
                    <Field label="Organisation type" required error={errors.orgType}>
                      <Select
                        value={form.orgType}
                        onValueChange={v => v && updateField('orgType', v)}
                      >
                        <SelectTrigger className="w-full h-10 border-zinc-300 focus:ring-teal-500 focus:border-teal-500">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          {ORG_TYPES.map(t => (
                            <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                    <Field label="Organisation website" required error={errors.website}>
                      <div className="relative">
                        <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                        <Input
                          id="website"
                          type="url"
                          placeholder="https://yourorg.org"
                          className={`pl-10 h-10 border-zinc-300 focus-visible:ring-teal-500 focus-visible:border-teal-500 ${
                            errors.website ? 'border-red-300 focus-visible:ring-red-400' : ''
                          }`}
                          value={form.website}
                          onChange={e => updateField('website', e.target.value)}
                        />
                      </div>
                    </Field>

                    <Field label="LinkedIn page" error={errors.linkedin} hint="Optional — helps us understand your organisation better">
                      <div className="relative">
                        <Linkedin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                        <Input
                          id="linkedin"
                          type="url"
                          placeholder="https://linkedin.com/company/your-org"
                          className={`pl-10 h-10 border-zinc-300 focus-visible:ring-teal-500 ${
                            errors.linkedin ? 'border-red-300 focus-visible:ring-red-400' : ''
                          }`}
                          value={form.linkedin}
                          onChange={e => updateField('linkedin', e.target.value)}
                        />
                      </div>
                    </Field>
                  </div>
                </div>

                {/* ── Section 2: Location & Focus ── */}
                <div className="px-5 sm:px-8 py-6 space-y-4">
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
                </div>

                {/* ── Section 3: Funding Details ── */}
                <div className="px-5 sm:px-8 py-6 space-y-4">
                  <Field
                    label="Search title"
                    required
                    error={errors.searchTitle}
                    hint="A short name to identify this search later"
                  >
                    <Input
                      id="searchTitle"
                      placeholder="e.g. Operational funding, New website, Vehicle purchase..."
                      className={`h-10 border-zinc-300 focus-visible:ring-teal-500 ${
                        errors.searchTitle ? 'border-red-300 focus-visible:ring-red-400' : ''
                      }`}
                      value={form.searchTitle || ''}
                      onChange={e => updateField('searchTitle', e.target.value)}
                    />
                  </Field>

                  <Field
                    label="What is this funding search for?"
                    required
                    error={errors.fundingPurpose}
                    hint={`${form.fundingPurpose.length} characters — the more detail, the better`}
                  >
                    <textarea
                      id="fundingPurpose"
                      rows={3}
                      placeholder="Describe what you need funding for. Include your target population, specific activities, and any relevant context..."
                      className={`w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none transition-shadow ${
                        errors.fundingPurpose
                          ? 'border-red-300 focus:ring-red-400'
                          : 'border-zinc-300'
                      }`}
                      value={form.fundingPurpose}
                      onChange={e => updateField('fundingPurpose', e.target.value)}
                    />
                  </Field>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                    <Field
                      label={`Funding amount sought (${activeMarket.currency})`}
                      required
                      error={errors.fundingAmount}
                    >
                      <div className="relative">
                        <DollarSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                        <Input
                          id="fundingAmount"
                          type="number"
                          placeholder="50000"
                          min={1}
                          className={`pl-10 h-10 border-zinc-300 focus-visible:ring-teal-500 ${
                            errors.fundingAmount ? 'border-red-300 focus-visible:ring-red-400' : ''
                          }`}
                          value={form.fundingAmount || ''}
                          onChange={e => updateField('fundingAmount', parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    </Field>

                    <Field
                      label="Previous or current funders"
                      hint="Optional — helps us find similar sources"
                    >
                      <Input
                        id="previousFunders"
                        placeholder="e.g. Lion Foundation, Otago Community Trust..."
                        className="h-10 border-zinc-300 focus-visible:ring-teal-500"
                        value={form.previousFunders}
                        onChange={e => updateField('previousFunders', e.target.value)}
                      />
                    </Field>
                  </div>
                </div>

                {/* ── Submit ── */}
                <div className="px-5 sm:px-8 py-6 bg-zinc-50/50">
                  <button
                    type="submit"
                    className="w-full h-12 flex items-center justify-center gap-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-semibold text-[15px] rounded-xl transition-all duration-200 active:scale-[0.99] shadow-md shadow-teal-600/20"
                  >
                    Find Grants
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

