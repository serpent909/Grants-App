'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Globe, Linkedin, DollarSign,
  AlertCircle, Sparkles, Check, ArrowRight,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { OrgInfo, SearchResult } from '@/lib/types';
import { listMarkets } from '@/lib/markets';

const MARKETS = listMarkets();

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ─── Loading overlay ──────────────────────────────────────────────────────────

function LoadingState({
  messages,
  messageIndex,
  progress,
}: {
  messages: string[];
  messageIndex: number;
  progress: number;
}) {
  return (
    <div className="px-8 py-10">
      <div className="flex flex-col items-center mb-10">
        <div className="relative w-14 h-14 mb-5">
          <div className="absolute inset-0 rounded-full bg-indigo-50" />
          <svg
            className="animate-spin absolute inset-0 w-14 h-14 text-indigo-600"
            fill="none"
            viewBox="0 0 56 56"
          >
            <circle
              cx="28" cy="28" r="22"
              stroke="currentColor"
              strokeWidth="3"
              strokeOpacity="0.15"
            />
            <path
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              d="M28 6 a22 22 0 0 1 22 22"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-indigo-600" />
          </div>
        </div>
        <p className="text-sm font-semibold text-zinc-800 text-center leading-snug">
          {messages[messageIndex]}
        </p>
        <p className="text-xs text-zinc-400 mt-1.5 text-center">
          This typically takes 30–90 seconds
        </p>
      </div>

      <div className="space-y-3 mb-10">
        {messages.map((msg, i) => {
          const done = i < messageIndex;
          const active = i === messageIndex;
          return (
            <div
              key={i}
              className={`flex items-center gap-3 text-sm transition-all duration-300 ${
                done ? 'opacity-50' : active ? 'opacity-100' : 'opacity-30'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                  done
                    ? 'bg-emerald-100'
                    : active
                    ? 'bg-indigo-600'
                    : 'bg-zinc-100'
                }`}
              >
                {done ? (
                  <Check className="w-3 h-3 text-emerald-600" />
                ) : active ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                ) : (
                  <span className="text-[9px] font-medium text-zinc-400">{i + 1}</span>
                )}
              </div>
              <span className={active ? 'font-medium text-zinc-900' : 'text-zinc-500'}>
                {msg}
              </span>
            </div>
          );
        })}
      </div>

      <div>
        <div className="flex justify-between items-center text-xs text-zinc-400 mb-2">
          <span>Searching grant databases...</span>
          <span className="font-medium tabular-nums">{Math.round(progress)}%</span>
        </div>
        <div className="h-1 bg-zinc-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const [form, setForm] = useState<OrgInfo>({
    website: '',
    linkedin: '',
    fundingPurpose: '',
    fundingAmount: 0,
    market: 'nz',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof OrgInfo, string>>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [apiError, setApiError] = useState<string | null>(null);

  const activeMarket = MARKETS.find(m => m.id === form.market) ?? MARKETS[0];

  const loadingMessages = [
    'Analysing your organisation...',
    `Searching for ${activeMarket.displayName} grants...`,
    'Evaluating funding opportunities...',
    'Scoring grant alignment...',
    'Calculating attainability...',
    'Finalising results...',
  ];

  const validate = useCallback((): boolean => {
    const newErrors: Partial<Record<keyof OrgInfo, string>> = {};
    if (!form.website.trim()) {
      newErrors.website = 'Website URL is required';
    } else if (!isValidUrl(form.website)) {
      newErrors.website = 'Please enter a valid URL (e.g. https://yourorg.org)';
    }
    if (!form.linkedin.trim()) {
      newErrors.linkedin = 'LinkedIn URL is required';
    } else if (!isValidUrl(form.linkedin)) {
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
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [form]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    if (!validate()) return;

    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingMessageIndex(0);

    let msgIdx = 0;
    let progress = 0;
    const interval = setInterval(() => {
      progress = Math.min(progress + Math.random() * 12 + 3, 90);
      setLoadingProgress(progress);
      if (msgIdx < loadingMessages.length - 1) {
        msgIdx++;
        setLoadingMessageIndex(msgIdx);
      }
    }, 2500);

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      clearInterval(interval);

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Server error' }));
        throw new Error(data.error || `Request failed with status ${response.status}`);
      }

      const result: SearchResult = await response.json();
      setLoadingProgress(100);
      sessionStorage.setItem('grantSearchResult', JSON.stringify(result));

      setTimeout(() => {
        router.push('/results');
      }, 300);
    } catch (err) {
      clearInterval(interval);
      setIsLoading(false);
      setLoadingProgress(0);
      setApiError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
    }
  }, [form, validate, router, loadingMessages.length]);

  const updateField = useCallback(<K extends keyof OrgInfo>(key: K, value: OrgInfo[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }));
  }, [errors]);

  return (
    <div className="min-h-screen bg-[#0c0c1e]">
      {/* ── Centered vertical layout ── */}
      <div className="relative px-6 py-16">

        {/* Dot grid background */}
        <div
          className="absolute inset-0 opacity-[0.09]"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.6) 1px, transparent 0)',
            backgroundSize: '32px 32px',
          }}
        />
        {/* Radial glow — top centre */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(99,102,241,0.4),transparent)]" />
        {/* Subtle bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-[#0c0c1e] to-transparent" />

        <div className="relative max-w-xl mx-auto">

          {/* ── Hero copy ── */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 bg-white/8 border border-white/10 text-white/60 text-xs font-medium px-3.5 py-1.5 rounded-full mb-7 backdrop-blur-sm">
              <Sparkles className="w-3 h-3" />
              AI-Powered Grant Discovery
            </div>

            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight mb-5">
              <span className="block text-white/50 text-2xl sm:text-3xl font-semibold mb-2 tracking-normal">
                Find the right grants
              </span>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400">
                {activeMarket.displayName}
              </span>
              <span className="text-white"> nonprofits</span>
            </h1>

            <p className="text-zinc-400 text-base leading-relaxed mb-8 max-w-sm mx-auto">
              AI searches hundreds of funding sources, scores every opportunity
              against your organisation, and ranks them by likelihood of success.
            </p>

            <div className="flex items-center justify-center gap-10 mb-2">
              {[
                ['200+', 'Grant sources searched'],
                ['AI-scored', 'Every opportunity'],
                ['Free', 'No sign-up needed'],
              ].map(([stat, label]) => (
                <div key={stat} className="text-center">
                  <div className="text-base font-bold text-white">{stat}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Form card ── */}
          <div className="bg-white rounded-2xl shadow-2xl ring-1 ring-white/10 overflow-hidden">
            {!isLoading && (
              <div className="px-7 pt-7 pb-5 border-b border-zinc-100">
                <h2 className="text-base font-semibold text-zinc-900">
                  Tell us about your organisation
                </h2>
                <p className="text-sm text-zinc-500 mt-0.5">
                  We&apos;ll find and score the most relevant grants for your specific needs.
                </p>
              </div>
            )}

            {isLoading ? (
              <LoadingState
                messages={loadingMessages}
                messageIndex={loadingMessageIndex}
                progress={loadingProgress}
              />
            ) : (
              <form onSubmit={handleSubmit} className="px-7 py-6 space-y-5">
                {apiError && (
                  <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <p className="text-sm leading-relaxed">{apiError}</p>
                  </div>
                )}

                {/* Country */}
                <Field label="Country" required>
                  <Select
                    value={form.market}
                    onValueChange={v => v && updateField('market', v)}
                  >
                    <SelectTrigger className="h-10 border-zinc-200 focus:ring-indigo-500 focus:border-indigo-500">
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent>
                      {MARKETS.map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.displayName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                {/* Website */}
                <Field label="Organisation Website" required error={errors.website}>
                  <div className="relative">
                    <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <Input
                      id="website"
                      type="url"
                      placeholder="https://yourorg.org"
                      className={`pl-10 h-10 border-zinc-200 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 ${
                        errors.website ? 'border-red-300 focus-visible:ring-red-400' : ''
                      }`}
                      value={form.website}
                      onChange={e => updateField('website', e.target.value)}
                    />
                  </div>
                </Field>

                {/* LinkedIn */}
                <Field label="LinkedIn Page" required error={errors.linkedin}>
                  <div className="relative">
                    <Linkedin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <Input
                      id="linkedin"
                      type="url"
                      placeholder="https://linkedin.com/company/your-org"
                      className={`pl-10 h-10 border-zinc-200 focus-visible:ring-indigo-500 ${
                        errors.linkedin ? 'border-red-300 focus-visible:ring-red-400' : ''
                      }`}
                      value={form.linkedin}
                      onChange={e => updateField('linkedin', e.target.value)}
                    />
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
                    id="fundingPurpose"
                    rows={3}
                    placeholder="Describe your organisation's mission and what you need funding for. Include your target population, specific activities, and geographic area..."
                    className={`w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none transition-shadow ${
                      errors.fundingPurpose
                        ? 'border-red-300 focus:ring-red-400'
                        : 'border-zinc-200'
                    }`}
                    value={form.fundingPurpose}
                    onChange={e => updateField('fundingPurpose', e.target.value)}
                  />
                </Field>

                {/* Funding Amount */}
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
                      className={`pl-10 h-10 border-zinc-200 focus-visible:ring-indigo-500 ${
                        errors.fundingAmount ? 'border-red-300 focus-visible:ring-red-400' : ''
                      }`}
                      value={form.fundingAmount || ''}
                      onChange={e => updateField('fundingAmount', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </Field>

                {/* Submit */}
                <button
                  type="submit"
                  className="w-full h-11 flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-semibold text-sm rounded-xl shadow-lg shadow-indigo-200 transition-all duration-200 hover:shadow-indigo-300 active:scale-[0.99]"
                >
                  Find Grants
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-zinc-700">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
      {hint && !error && <p className="text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}
