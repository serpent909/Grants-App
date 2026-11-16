'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Globe, Linkedin, DollarSign,
  AlertCircle, ArrowRight, ArrowLeft, Search,
  Check, Pencil, Sparkles,
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

// ─── Step indicator ────────────────────────────────────────────────────────────

const STEPS = [
  { num: 1, label: 'Organisation' },
  { num: 2, label: 'Location' },
  { num: 3, label: 'Funding' },
  { num: 4, label: 'Review' },
] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="flex items-center justify-between w-full max-w-md mx-auto" aria-label="Search steps">
      {STEPS.map((s, i) => (
        <li
          key={s.num}
          className="flex items-center flex-1 last:flex-none"
          aria-current={s.num === current ? 'step' : undefined}
        >
          {/* Step circle + label */}
          <div className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors duration-300 ${
                s.num < current
                  ? 'bg-teal-600 text-white'
                  : s.num === current
                  ? 'bg-white dark:bg-zinc-800 border-2 border-teal-600 text-teal-600'
                  : 'bg-white dark:bg-zinc-800 border-2 border-zinc-300 dark:border-zinc-600 text-zinc-400'
              }`}
            >
              {s.num < current ? <Check className="w-4 h-4" aria-label={`Step ${s.num} complete`} /> : s.num}
            </div>
            <span
              className={`sr-only sm:not-sr-only sm:block text-xs sm:mt-1.5 font-medium transition-colors duration-300 ${
                s.num <= current ? 'text-teal-700 dark:text-teal-400' : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              {s.label}
            </span>
          </div>

          {/* Connecting line */}
          {i < STEPS.length - 1 && (
            <div
              className={`flex-1 h-0.5 mx-2 sm:mx-3 transition-colors duration-300 ${
                s.num < current ? 'bg-teal-500' : 'bg-zinc-200 dark:bg-zinc-700'
              }`}
            />
          )}
        </li>
      ))}
    </ol>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewSearchPage() {
  const router = useRouter();
  const cardRef = useRef<HTMLDivElement>(null);
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
  const [step, setStep] = useState(1);
  // When re-running a saved search, its ID — the results replace that search
  // instead of piling up another one with the same name.
  const [rerunId, setRerunId] = useState<string | null>(null);
  // Name of the search the organisation details were copied from, if any.
  const [prefilledFrom, setPrefilledFrom] = useState<string | null>(null);
  const prefillSettled = useRef(false);
  const { data: savedSearches } = useSavedSearches();

  // Prefill from saved search re-run
  useEffect(() => {
    const raw = sessionStorage.getItem('grantSearchPrefill');
    if (raw) {
      sessionStorage.removeItem('grantSearchPrefill');
      prefillSettled.current = true;
      // One-off hydration from sessionStorage on mount (re-run of a saved search).
      /* eslint-disable react-hooks/set-state-in-effect */
      try {
        const inputs = JSON.parse(raw) as Partial<OrgInfo> & { __rerunId?: unknown };
        if (typeof inputs.__rerunId === 'string') setRerunId(inputs.__rerunId);
        // Only take the fields we know, with the types we expect.
        const text = (v: unknown) => (typeof v === 'string' ? v : '');
        const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
        setForm({
          searchTitle: text(inputs.searchTitle),
          website: text(inputs.website),
          linkedin: text(inputs.linkedin),
          fundingPurpose: text(inputs.fundingPurpose),
          fundingAmount: typeof inputs.fundingAmount === 'number' ? inputs.fundingAmount : 0,
          market: 'nz',
          regions: list(inputs.regions),
          sectors: list(inputs.sectors),
          orgType: text(inputs.orgType),
          previousFunders: text(inputs.previousFunders),
        });
        setStep(4); // skip to review
      } catch { /* ignore malformed data */ }
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, []);

  // A new search starts with the organisation details (not the funding details)
  // from the most recent search, so they are not retyped every time.
  useEffect(() => {
    if (prefillSettled.current || !savedSearches) return;
    prefillSettled.current = true;
    const last = savedSearches.find(s => s.result?.inputs);
    const inputs = last?.result.inputs;
    if (!last || !inputs) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setForm(prev =>
      // Never overwrite anything the user has already started typing.
      prev.website || prev.orgType || prev.regions.length || prev.sectors.length
        ? prev
        : {
            ...prev,
            website: inputs.website ?? '',
            linkedin: inputs.linkedin ?? '',
            orgType: inputs.orgType ?? '',
            regions: Array.isArray(inputs.regions) ? inputs.regions : [],
            sectors: Array.isArray(inputs.sectors) ? inputs.sectors : [],
            previousFunders: inputs.previousFunders ?? '',
          },
    );
    setPrefilledFrom(last.name);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [savedSearches]);

  const clearPrefill = useCallback(() => {
    setForm(prev => ({
      ...prev, website: '', linkedin: '', orgType: '', regions: [], sectors: [], previousFunders: '',
    }));
    setPrefilledFrom(null);
  }, []);

  // Scroll card into view on step change
  useEffect(() => {
    if (step > 1) {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [step]);

  // ── Per-step validation ──

  const validateStep = useCallback((s: number): boolean => {
    const newErrors: Partial<Record<keyof OrgInfo, string>> = {};

    if (s === 1) {
      if (!form.orgType) {
        newErrors.orgType = 'Please select your organisation type';
      }
      if (!form.website.trim()) {
        newErrors.website = 'Website URL is required';
      } else if (!isValidUrl(form.website)) {
        newErrors.website = 'Please enter a valid URL (e.g. https://yourorg.org)';
      }
      if (form.linkedin.trim() && !isValidUrl(form.linkedin)) {
        newErrors.linkedin = 'Please enter a valid LinkedIn URL';
      }
    }

    if (s === 2) {
      if (form.regions.length === 0) {
        newErrors.regions = 'Please select at least one operating region';
      }
      if (form.sectors.length === 0) {
        newErrors.sectors = 'Please select at least one sector';
      }
    }

    if (s === 3) {
      if (!form.searchTitle?.trim()) {
        newErrors.searchTitle = 'Please give this search a title';
      }
      if (!form.fundingPurpose.trim()) {
        newErrors.fundingPurpose = 'Please describe what this funding is for';
      } else if (form.fundingPurpose.trim().length < 20) {
        newErrors.fundingPurpose = 'Please provide more detail (at least 20 characters)';
      }
      if (!form.fundingAmount || form.fundingAmount <= 0) {
        newErrors.fundingAmount = 'Please enter the funding amount you are seeking';
      } else if (form.fundingAmount > 100_000_000) {
        newErrors.fundingAmount = 'Please enter an amount of $100 million or less';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [form]);

  const validate = useCallback((): boolean => {
    // Full validation as safety net for submit
    const s1 = validateStep(1);
    const s2 = validateStep(2);
    const s3 = validateStep(3);
    if (!s1) { setStep(1); return false; }
    if (!s2) { setStep(2); return false; }
    if (!s3) { setStep(3); return false; }
    return true;
  }, [validateStep]);

  const goNext = useCallback(() => {
    if (validateStep(step)) {
      setStep(s => Math.min(s + 1, 4));
    }
  }, [step, validateStep]);

  const goBack = useCallback(() => {
    setStep(s => Math.max(s - 1, 1));
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    // On intermediate steps, Enter key advances instead of submitting
    if (step < 4) {
      goNext();
      return;
    }

    if (!validate()) return;

    setIsLoading(true);
    sessionStorage.setItem('grantSearchForm', JSON.stringify(form));
    if (rerunId) sessionStorage.setItem('grantSearchRerunId', rerunId);
    else sessionStorage.removeItem('grantSearchRerunId');
    router.push('/results?mode=search');
  }, [form, validate, router, step, goNext, rerunId]);

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

  // ── Step subtitles ──

  const stepSubtitle = [
    '',
    'Tell us about your organisation',
    'Where you operate and what you focus on',
    'What you need funding for',
    'Review your details before searching',
  ][step];

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-canvas">
      <div className="px-4 sm:px-6 py-8 sm:py-12">
        <div className="max-w-3xl mx-auto">

          <div className="text-center mb-8">
            <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              {rerunId ? 'Update this search' : 'New funding search'}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 max-w-md mx-auto leading-relaxed">
              {rerunId
                ? 'Change anything you like and run it again. The saved search is refreshed with the new results.'
                : 'Tell us what you need funding for. We match and rank grants from hundreds of New Zealand funders.'}
            </p>
          </div>

          {/* ── Form card ── */}
          <div ref={cardRef} className="scroll-mt-20 bg-white dark:bg-zinc-800 rounded-2xl shadow-lg shadow-black/5 ring-1 ring-zinc-200 dark:ring-zinc-700 overflow-hidden">
            {!isLoading && (
              <div className="px-5 sm:px-8 pt-7 pb-5 bg-zinc-50/70 dark:bg-zinc-800/50 border-b border-zinc-200/60 dark:border-zinc-700/60">
                <StepIndicator current={step} />
                <div className="text-center mt-5">
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-display">
                    {STEPS[step - 1].label}
                  </h2>
                  <p className="text-sm text-zinc-500 mt-1">
                    {stepSubtitle}
                  </p>
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="px-5 sm:px-8 py-16 flex flex-col items-center">
                <div className="w-10 h-10 rounded-full bg-teal-50 dark:bg-teal-950 flex items-center justify-center mb-4">
                  <Search className="w-5 h-5 text-teal-600 animate-pulse" />
                </div>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Starting search...</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                {apiError && (
                  <div className="px-5 sm:px-8 pt-6">
                    <div className="flex items-start gap-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl p-4">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <p className="text-sm leading-relaxed">{apiError}</p>
                    </div>
                  </div>
                )}

                {/* ── Step 1: Organisation ── */}
                {step === 1 && (
                  <div className="px-5 sm:px-8 py-6 space-y-4 animate-in fade-in duration-200">
                    {prefilledFrom && !rerunId && (
                      <p className="flex items-start gap-2 text-xs text-teal-800 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 rounded-lg px-3 py-2">
                        <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
                        <span>
                          Organisation details copied from your last search, &ldquo;{prefilledFrom}&rdquo;.{' '}
                          <button type="button" onClick={clearPrefill} className="font-semibold underline underline-offset-2 hover:no-underline">
                            Start blank
                          </button>
                        </span>
                      </p>
                    )}
                    <Field label="Organisation type" required error={errors.orgType}>
                      <Select
                        value={form.orgType}
                        onValueChange={v => v && updateField('orgType', v)}
                      >
                        <SelectTrigger className="w-full h-10 border-zinc-300 focus:ring-teal-500 focus:border-teal-500">
                          <SelectValue placeholder="Select type">
                            {form.orgType ? ORG_TYPES.find(t => t.id === form.orgType)?.label : null}
                          </SelectValue>
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
                            aria-label="Organisation website"
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
                            aria-label="LinkedIn page"
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
                )}

                {/* ── Step 2: Location & Focus ── */}
                {step === 2 && (
                  <div className="px-5 sm:px-8 py-6 space-y-4 animate-in fade-in duration-200">
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
                )}

                {/* ── Step 3: Funding Details ── */}
                {step === 3 && (
                  <div className="px-5 sm:px-8 py-6 space-y-4 animate-in fade-in duration-200">
                    <Field
                      label="Search title"
                      required
                      error={errors.searchTitle}
                      hint="A short name to identify this search later"
                    >
                      <Input
                        id="searchTitle"
                            aria-label="Search title"
                        maxLength={200}
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
                      hint={`${form.fundingPurpose.length} characters${
                        form.fundingPurpose.length >= 300 ? ' — excellent detail' :
                        form.fundingPurpose.length >= 150 ? ' — good detail' :
                        ' — the more detail, the better'
                      }`}
                    >
                      <textarea
                        id="fundingPurpose"
                            aria-label="What is this funding search for?"
                        rows={4}
                        maxLength={5000}
                        placeholder="Describe what you need funding for. Include your target population, specific activities, and any relevant context..."
                        className={`w-full rounded-lg border bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none transition-shadow ${
                          errors.fundingPurpose
                            ? 'border-red-300 focus:ring-red-400'
                            : 'border-zinc-300 dark:border-zinc-600'
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
                            aria-label="Funding amount sought"
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
                            aria-label="Previous or current funders"
                          placeholder="e.g. Lion Foundation, Otago Community Trust..."
                          className="h-10 border-zinc-300 focus-visible:ring-teal-500"
                          value={form.previousFunders}
                          onChange={e => updateField('previousFunders', e.target.value)}
                        />
                      </Field>
                    </div>
                  </div>
                )}

                {/* ── Step 4: Review ── */}
                {step === 4 && (
                  <div className="px-5 sm:px-8 py-6 space-y-5 animate-in fade-in duration-200">

                    {/* Organisation */}
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 bg-zinc-50/70 dark:bg-zinc-900/40">
                        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Organisation</h3>
                        <button
                          type="button"
                          onClick={() => setStep(1)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                      </div>
                      <div className="px-4 py-3 space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-zinc-500 dark:text-zinc-400">Type</span>
                          <span className="text-zinc-900 dark:text-zinc-100 font-medium">
                            {ORG_TYPES.find(t => t.id === form.orgType)?.label || '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500 dark:text-zinc-400">Website</span>
                          <span className="text-zinc-900 dark:text-zinc-100 font-medium truncate max-w-[60%] text-right">
                            {form.website || '—'}
                          </span>
                        </div>
                        {form.linkedin && (
                          <div className="flex justify-between">
                            <span className="text-zinc-500 dark:text-zinc-400">LinkedIn</span>
                            <span className="text-zinc-900 dark:text-zinc-100 font-medium truncate max-w-[60%] text-right">
                              {form.linkedin}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Location & Focus */}
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 bg-zinc-50/70 dark:bg-zinc-900/40">
                        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Location & Focus</h3>
                        <button
                          type="button"
                          onClick={() => setStep(2)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                      </div>
                      <div className="px-4 py-3 space-y-3 text-sm">
                        <div>
                          <span className="text-zinc-500 dark:text-zinc-400 block mb-1.5">Regions</span>
                          <div className="flex flex-wrap gap-1.5">
                            {form.regions.map(id => {
                              const region = activeMarket.regions.find(r => r.id === id);
                              return (
                                <span
                                  key={id}
                                  className="inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800"
                                >
                                  {region?.name || id}
                                </span>
                              );
                            })}
                            {form.regions.length === 0 && <span className="text-zinc-400">None selected</span>}
                          </div>
                        </div>
                        <div>
                          <span className="text-zinc-500 dark:text-zinc-400 block mb-1.5">Sectors</span>
                          <div className="flex flex-wrap gap-1.5">
                            {form.sectors.map(id => {
                              const sector = SECTORS.find(s => s.id === id);
                              return (
                                <span
                                  key={id}
                                  className="inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800"
                                >
                                  {sector?.label || id}
                                </span>
                              );
                            })}
                            {form.sectors.length === 0 && <span className="text-zinc-400">None selected</span>}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Funding Details */}
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 bg-zinc-50/70 dark:bg-zinc-900/40">
                        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Funding Details</h3>
                        <button
                          type="button"
                          onClick={() => setStep(3)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                      </div>
                      <div className="px-4 py-3 space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-zinc-500 dark:text-zinc-400">Search title</span>
                          <span className="text-zinc-900 dark:text-zinc-100 font-medium">{form.searchTitle || '—'}</span>
                        </div>
                        <div>
                          <span className="text-zinc-500 dark:text-zinc-400 block mb-1">Purpose</span>
                          <p className="text-zinc-900 dark:text-zinc-100 text-sm leading-relaxed">
                            {form.fundingPurpose || '—'}
                          </p>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500 dark:text-zinc-400">Amount sought</span>
                          <span className="text-zinc-900 dark:text-zinc-100 font-medium">
                            {form.fundingAmount
                              ? `${activeMarket.currencySymbol}${form.fundingAmount.toLocaleString()}`
                              : '—'}
                          </span>
                        </div>
                        {form.previousFunders && (
                          <div className="flex justify-between">
                            <span className="text-zinc-500 dark:text-zinc-400">Previous funders</span>
                            <span className="text-zinc-900 dark:text-zinc-100 font-medium truncate max-w-[60%] text-right">
                              {form.previousFunders}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Navigation footer ── */}
                <div className="px-5 sm:px-8 py-6 bg-zinc-50/50 dark:bg-zinc-800/30 flex flex-col-reverse sm:flex-row sm:justify-between gap-3">
                  {step > 1 ? (
                    <button
                      type="button"
                      onClick={goBack}
                      className="inline-flex items-center justify-center gap-2 h-11 px-6 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 rounded-xl transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Back
                    </button>
                  ) : (
                    <div />
                  )}

                  {step < 4 ? (
                    <button
                      key="next"
                      type="button"
                      onClick={goNext}
                      className="inline-flex items-center justify-center gap-2 h-11 px-8 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-semibold text-sm rounded-xl transition-all duration-200 active:scale-[0.99] shadow-md shadow-teal-600/20"
                    >
                      Next
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      key="submit"
                      type="submit"
                      className="inline-flex items-center justify-center gap-2 h-11 px-8 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-semibold text-sm rounded-xl transition-all duration-200 active:scale-[0.99] shadow-md shadow-teal-600/20"
                    >
                      {rerunId ? 'Run search again' : 'Find Grants'}
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
