'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, Linkedin, Search, DollarSign, Target, BarChart2, TrendingUp, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
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
  }, [form, validate, router]);

  const updateField = useCallback(<K extends keyof OrgInfo>(key: K, value: OrgInfo[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }));
  }, [errors]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-teal-50">
      {/* Hero */}
      <section className="py-16 px-4 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 text-sm font-medium px-4 py-1.5 rounded-full mb-6">
            <Search className="w-3.5 h-3.5" />
            AI-Powered Grant Discovery
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4 tracking-tight">
            Find the right {activeMarket.displayName} grants
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-teal-600"> for your mission</span>
          </h1>
          <p className="text-lg text-slate-600 mb-8 max-w-2xl mx-auto">
            Enter your organisation details and let AI search across government, foundation, corporate, and community funding sources — scored and ranked for your specific needs.
          </p>
        </div>
      </section>

      {/* Form */}
      <section className="px-4 pb-16">
        <div className="max-w-2xl mx-auto">
          <Card className="shadow-xl border-0 bg-white/90 backdrop-blur">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl text-slate-900">Tell us about your organisation</CardTitle>
              <CardDescription>We&apos;ll use AI to find and score the most relevant grants for you.</CardDescription>
            </CardHeader>
            <CardContent>
              {apiError && (
                <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-sm">{apiError}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Country */}
                <div className="space-y-1.5">
                  <Label className="text-slate-700 font-medium">
                    Country <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={form.market}
                    onValueChange={v => v && updateField('market', v)}
                    disabled={isLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent>
                      {MARKETS.map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.displayName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Website */}
                <div className="space-y-1.5">
                  <Label htmlFor="website" className="text-slate-700 font-medium">
                    Organisation Website <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      id="website"
                      type="url"
                      placeholder="https://yourorg.org"
                      className={`pl-9 ${errors.website ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
                      value={form.website}
                      onChange={e => updateField('website', e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  {errors.website && <p className="text-red-500 text-sm">{errors.website}</p>}
                </div>

                {/* LinkedIn */}
                <div className="space-y-1.5">
                  <Label htmlFor="linkedin" className="text-slate-700 font-medium">
                    LinkedIn URL <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      id="linkedin"
                      type="url"
                      placeholder="https://linkedin.com/company/your-org"
                      className={`pl-9 ${errors.linkedin ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
                      value={form.linkedin}
                      onChange={e => updateField('linkedin', e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  {errors.linkedin && <p className="text-red-500 text-sm">{errors.linkedin}</p>}
                </div>

                {/* Funding Purpose */}
                <div className="space-y-1.5">
                  <Label htmlFor="fundingPurpose" className="text-slate-700 font-medium">
                    What is this funding search for? <span className="text-red-500">*</span>
                  </Label>
                  <textarea
                    id="fundingPurpose"
                    rows={4}
                    placeholder="e.g. We are seeking funding to expand our community mental health programme for rangatahi in South Auckland, including hiring two part-time counsellors and running weekly hui..."
                    className={`w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none ${
                      errors.fundingPurpose ? 'border-red-400 focus-visible:ring-red-400' : 'border-input'
                    }`}
                    value={form.fundingPurpose}
                    onChange={e => updateField('fundingPurpose', e.target.value)}
                    disabled={isLoading}
                  />
                  {errors.fundingPurpose && <p className="text-red-500 text-sm">{errors.fundingPurpose}</p>}
                  <p className="text-slate-400 text-xs">{form.fundingPurpose.length} characters — the more detail, the better the results</p>
                </div>

                {/* Funding Amount */}
                <div className="space-y-1.5">
                  <Label htmlFor="fundingAmount" className="text-slate-700 font-medium">
                    How much funding are you seeking? ({activeMarket.currency}) <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      id="fundingAmount"
                      type="number"
                      placeholder="50000"
                      min={1}
                      className={`pl-9 ${errors.fundingAmount ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
                      value={form.fundingAmount || ''}
                      onChange={e => updateField('fundingAmount', parseFloat(e.target.value) || 0)}
                      disabled={isLoading}
                    />
                  </div>
                  {errors.fundingAmount && <p className="text-red-500 text-sm">{errors.fundingAmount}</p>}
                </div>

                {/* Loading State */}
                {isLoading && (
                  <div className="space-y-3 py-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-blue-600 font-medium animate-pulse">
                        {loadingMessages[loadingMessageIndex]}
                      </span>
                      <span className="text-slate-400">{Math.round(loadingProgress)}%</span>
                    </div>
                    <Progress value={loadingProgress} className="h-2" />
                    <p className="text-slate-400 text-xs text-center">This can take 30–60 seconds while AI searches and scores grants</p>
                  </div>
                )}

                {/* Submit */}
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-12 text-base bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 text-white font-semibold shadow-lg shadow-blue-200"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Searching...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Search className="w-5 h-5" />
                      Find Grants
                    </span>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Score Criteria Explainer */}
          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white/70 backdrop-blur rounded-xl p-5 border border-blue-100">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Target className="w-4 h-4 text-blue-600" />
                </div>
                <h3 className="font-semibold text-slate-800">Alignment Score</h3>
              </div>
              <p className="text-sm text-slate-600">How well the grant&apos;s purpose matches your organisation&apos;s mission and specific funding request.</p>
            </div>
            <div className="bg-white/70 backdrop-blur rounded-xl p-5 border border-teal-100">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-teal-100 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-teal-600" />
                </div>
                <h3 className="font-semibold text-slate-800">Attainability Score</h3>
              </div>
              <p className="text-sm text-slate-600">Likelihood of success based on competition level, funder focus, and your organisation&apos;s fit.</p>
            </div>
            <div className="bg-white/70 backdrop-blur rounded-xl p-5 border border-purple-100">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                  <BarChart2 className="w-4 h-4 text-purple-600" />
                </div>
                <h3 className="font-semibold text-slate-800">Application Difficulty</h3>
              </div>
              <p className="text-sm text-slate-600">Estimated effort required to apply — from a simple online form to a multi-stage proposal process.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
