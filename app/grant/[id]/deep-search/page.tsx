'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, Microscope, Printer } from 'lucide-react';
import { useDeepSearch } from '@/lib/deep-search-storage';
import { errorMessage } from '@/lib/fetcher';
import { LINK_CLASS } from '@/lib/grant-ui';
import { ScoreRing } from '@/components/grant/score';
import DeepSearchDetails, { safeHref } from '@/components/grant/deep-search-details';
import { PageShell, EmptyState, ListSkeleton, ErrorState } from '@/components/page-shell';

/**
 * Standalone, printable deep-research report for one grant.
 * Linked from the shortlist and applications pages ("Open full report").
 */
export default function DeepSearchPage() {
  const params = useParams();
  const router = useRouter();
  const grantId = decodeURIComponent(params.id as string);
  const { data, isLoading, error, mutate } = useDeepSearch(grantId);

  if (isLoading) {
    return <PageShell width="max-w-3xl"><ListSkeleton rows={4} /></PageShell>;
  }

  if (error) {
    return (
      <PageShell width="max-w-3xl">
        <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell width="max-w-3xl">
        <EmptyState
          icon={Microscope}
          title="No research for this grant yet"
          action={
            <Link
              href="/saved"
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              Go to searches
            </Link>
          }
        >
          Open the grant from one of your funding searches and run a Deep Search to build this report.
        </EmptyState>
      </PageShell>
    );
  }

  const grantHref = safeHref(data.grantUrl);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-canvas">
      {/* Header */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5">
          <div className="flex items-center justify-between mb-4 print:hidden">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors group"
            >
              <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" aria-hidden />
              Back
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden />
              Print
            </button>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 leading-tight font-display">{data.grantName}</h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">by {data.funder}</p>
              {grantHref && (
                <a
                  href={grantHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 mt-3 text-xs group ${LINK_CLASS}`}
                >
                  View grant page
                  <ExternalLink className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" aria-hidden />
                </a>
              )}
            </div>
            <ScoreRing score={data.scores?.overall ?? 0} />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <DeepSearchDetails deep={data} variant="card" showOverallChange />
        <p className="text-xs text-zinc-500 dark:text-zinc-500 text-center pt-5">
          Researched {new Date(data.searchedAt).toLocaleString('en-NZ', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
          })}. Scores and information are AI-generated estimates — always verify details directly with funders.
        </p>
      </div>
    </div>
  );
}
