'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Bookmark, Trash2, ArrowRight, Search, CalendarDays,
  RotateCcw, History, Star, FileText,
} from 'lucide-react';
import { useSavedSearches, deleteSaved, SavedSearch } from '@/lib/saved-searches';
import { useShortlistedBySearch } from '@/lib/shortlist-storage';
import { useApplicationsByStatus } from '@/lib/application-storage';
import { getMarket } from '@/lib/markets';
import { errorMessage } from '@/lib/fetcher';
import { PRIMARY_BUTTON_CLASS } from '@/lib/grant-ui';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { PageShell, PageHeader, EmptyState, ListSkeleton, ErrorState } from '@/components/page-shell';
import ConfirmDialog from '@/components/confirm-dialog';
import { toast } from '@/components/toast';

export default function SavedPage() {
  const router = useRouter();
  const { data: searches = [], isLoading, error, mutate } = useSavedSearches();
  const { data: shortlistGroups = {} } = useShortlistedBySearch();
  const { data: appsByStatus } = useApplicationsByStatus();
  const [deleteConfirm, setDeleteConfirm] = useState<SavedSearch | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Count applications per search title
  const appCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const apps of Object.values(appsByStatus ?? {})) {
      for (const app of apps) {
        const key = app.searchTitle || '';
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  }, [appsByStatus]);

  const shortlistCount = (name: string) => shortlistGroups[name]?.length ?? 0;
  const appCount = (name: string) => appCounts[name] ?? 0;

  function handleRerun(saved: SavedSearch) {
    if (saved.result.inputs) {
      sessionStorage.setItem('grantSearchPrefill', JSON.stringify(saved.result.inputs));
    }
    router.push('/');
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await deleteSaved(deleteConfirm.id);
      toast.success('Search deleted');
      setDeleteConfirm(null);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete this search.'));
    } finally {
      setDeleting(false);
    }
  }

  const linkedShortlisted = deleteConfirm ? shortlistCount(deleteConfirm.name) : 0;
  const linkedApps = deleteConfirm ? appCount(deleteConfirm.name) : 0;

  return (
    <PageShell>
      <PageHeader
        icon={History}
        title="Funding Searches"
        subtitle={
          isLoading ? 'Loading…'
            : searches.length === 0 ? 'No searches yet'
            : `${searches.length} saved search${searches.length === 1 ? '' : 'es'}`
        }
        actions={
          <Link
            href="/"
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl ${PRIMARY_BUTTON_CLASS}`}
          >
            <Search className="w-3.5 h-3.5" aria-hidden />
            New search
          </Link>
        }
      />

      {isLoading ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
      ) : searches.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="No funding searches yet"
          action={
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <Search className="w-3.5 h-3.5" aria-hidden />
              Run a search
            </Link>
          }
        >
          Run a search and it will be saved here automatically, ready to revisit or re-run.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {searches.map(saved => {
            const market = getMarket(saved.market);
            const searchDate = new Date(saved.result.searchedAt || saved.savedAt).toLocaleDateString(market.locale, {
              day: 'numeric', month: 'short', year: 'numeric',
            });
            const shortlisted = shortlistCount(saved.name);
            const apps = appCount(saved.name);

            return (
              <li
                key={saved.id}
                className="relative bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 p-5 shadow-sm hover:shadow-md hover:ring-teal-300 dark:hover:ring-teal-700 transition-all group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1.5">
                      {/* Stretched link: the whole card opens the search, while
                          the action buttons stay independently focusable. */}
                      <Link
                        href={`/results?saved=${encodeURIComponent(saved.id)}`}
                        className="group-hover:text-teal-700 dark:group-hover:text-teal-400 transition-colors after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-teal-500"
                      >
                        {saved.name}
                      </Link>
                    </h2>

                    {saved.orgSummary && (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-2 mb-3">
                        {saved.orgSummary}
                      </p>
                    )}

                    <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400 flex-wrap">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">
                        {saved.grantCount} grant{saved.grantCount === 1 ? '' : 's'} found
                      </span>
                      {shortlisted > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-800 font-medium">
                          <Star className="w-3 h-3" aria-hidden />
                          {shortlisted} shortlisted
                        </span>
                      )}
                      {apps > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 ring-1 ring-blue-200 dark:ring-blue-800 font-medium">
                          <FileText className="w-3 h-3" aria-hidden />
                          {apps} application{apps === 1 ? '' : 's'}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <CalendarDays className="w-3 h-3" aria-hidden />
                        Searched {searchDate}
                      </span>
                    </div>
                  </div>

                  <div className="relative z-10 flex items-center gap-1 shrink-0">
                    {saved.result.inputs && (
                      <Tooltip>
                        <TooltipTrigger
                          onClick={() => handleRerun(saved)}
                          aria-label={`Edit and re-run ${saved.name}`}
                          className="p-2 rounded-lg text-zinc-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950 transition-colors"
                        >
                          <RotateCcw className="w-4 h-4" aria-hidden />
                        </TooltipTrigger>
                        <TooltipContent>Edit &amp; re-run search</TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger
                        onClick={() => setDeleteConfirm(saved)}
                        aria-label={`Delete ${saved.name}`}
                        className="p-2 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden />
                      </TooltipTrigger>
                      <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                    <span className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-950 group-hover:bg-teal-100 dark:group-hover:bg-teal-900 flex items-center justify-center transition-colors pointer-events-none" aria-hidden>
                      <ArrowRight className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={!!deleteConfirm}
        title="Delete search?"
        confirmLabel="Delete search"
        tone="danger"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm(null)}
      >
        {deleteConfirm && (
          <>
            <p>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">&ldquo;{deleteConfirm.name}&rdquo;</span>{' '}
              will be permanently deleted.
            </p>
            {(linkedShortlisted > 0 || linkedApps > 0) && (
              <p className="text-xs bg-zinc-50 dark:bg-zinc-900 rounded-lg px-3 py-2">
                Your {[
                  linkedShortlisted > 0 && `${linkedShortlisted} shortlisted grant${linkedShortlisted === 1 ? '' : 's'}`,
                  linkedApps > 0 && `${linkedApps} application${linkedApps === 1 ? '' : 's'}`,
                ].filter(Boolean).join(' and ')} from this search will not be affected.
              </p>
            )}
          </>
        )}
      </ConfirmDialog>
    </PageShell>
  );
}
