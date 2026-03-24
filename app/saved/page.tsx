'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bookmark, Trash2, ArrowRight, Search, CalendarDays, RotateCcw,
  History, Loader2, Star, FileText, AlertTriangle, X,
} from 'lucide-react';
import { useSavedSearches, deleteSaved, SavedSearch } from '@/lib/saved-searches';
import { useShortlistedBySearch } from '@/lib/shortlist-storage';
import { getMarket } from '@/lib/markets';
import { GrantApplication } from '@/lib/types';
import useSWR from 'swr';

const ACTIVE_STATUSES = new Set(['preparing', 'submitted', 'under-review']);

export default function SavedPage() {
  const router = useRouter();
  const { data: searches = [], isLoading } = useSavedSearches();
  const { data: shortlistedBySearch = {} } = useShortlistedBySearch();
  const { data: allApps = [] } = useSWR<GrantApplication[]>(
    'applications:all',
    () => fetch('/api/applications').then(r => r.ok ? r.json() : []),
    { revalidateOnFocus: false },
  );

  const [confirmDelete, setConfirmDelete] = useState<SavedSearch | null>(null);

  // Build app counts by search title
  const appsBySearch: Record<string, { active: number; total: number }> = {};
  for (const app of allApps) {
    const key = app.searchTitle || '';
    if (!appsBySearch[key]) appsBySearch[key] = { active: 0, total: 0 };
    appsBySearch[key].total++;
    if (ACTIVE_STATUSES.has(app.status)) appsBySearch[key].active++;
  }

  function getShortlistCount(name: string): number {
    return shortlistedBySearch[name]?.length ?? 0;
  }

  function getAppCounts(name: string): { active: number; total: number } {
    return appsBySearch[name] ?? { active: 0, total: 0 };
  }

  function handleOpen(saved: SavedSearch) {
    sessionStorage.setItem('grantSearchResult', JSON.stringify(saved.result));
    router.push(`/results?saved=${saved.id}`);
  }

  function handleDeleteClick(saved: SavedSearch, e: React.MouseEvent) {
    e.stopPropagation();

    const { active } = getAppCounts(saved.name);
    if (active > 0) {
      // Block — active applications exist
      return;
    }

    const shortlisted = getShortlistCount(saved.name);
    if (shortlisted > 0) {
      // Warn — shortlisted grants will be orphaned
      setConfirmDelete(saved);
      return;
    }

    // No shortlisted or applications — delete directly
    deleteSaved(saved.id);
  }

  async function handleConfirmDelete() {
    if (!confirmDelete) return;
    // Remove shortlisted grants tied to this search
    await fetch(`/api/shortlist?searchTitle=${encodeURIComponent(confirmDelete.name)}`, { method: 'DELETE' });
    await deleteSaved(confirmDelete.id);
    setConfirmDelete(null);
  }

  function handleRerun(saved: SavedSearch, e: React.MouseEvent) {
    e.stopPropagation();
    if (saved.result.inputs) {
      sessionStorage.setItem('grantSearchPrefill', JSON.stringify(saved.result.inputs));
    }
    router.push('/');
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f7f5f0] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f5f0]">
      <div className="max-w-3xl mx-auto px-6 py-12">

        <div className="flex items-center gap-3 mb-8">
          <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center">
            <History className="w-4 h-4 text-teal-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-900">Funding Searches</h1>
            <p className="text-sm text-zinc-500">
              {searches.length === 0 ? 'No searches yet' : `${searches.length} active search${searches.length === 1 ? '' : 'es'}`}
            </p>
          </div>
        </div>

        {searches.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-200 py-20 text-center shadow-sm">
            <Bookmark className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
            <p className="font-semibold text-zinc-400 text-sm">No funding searches yet</p>
            <p className="text-xs text-zinc-400 mt-1 mb-6">
              Run a search and it will appear here automatically.
            </p>
            <button
              onClick={() => router.push('/')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
              Run a search
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {searches.map(saved => {
              const market = getMarket(saved.market);
              const savedDate = new Date(saved.savedAt).toLocaleDateString(market.locale, {
                day: 'numeric', month: 'short', year: 'numeric',
              });
              const searchDate = new Date(saved.result.searchedAt).toLocaleDateString(market.locale, {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              });

              const shortlistCount = getShortlistCount(saved.name);
              const { active: activeApps, total: totalApps } = getAppCounts(saved.name);
              const hasActiveApps = activeApps > 0;

              return (
                <div
                  key={saved.id}
                  onClick={() => handleOpen(saved)}
                  className="bg-white rounded-xl border border-zinc-200 p-5 shadow-sm hover:shadow-md hover:border-teal-200 transition-all cursor-pointer group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <h2 className="font-semibold text-zinc-900 group-hover:text-teal-700 transition-colors">
                          {saved.name}
                        </h2>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-100">
                          {market.displayName}
                        </span>
                      </div>

                      {saved.orgSummary && (
                        <p className="text-sm text-zinc-500 leading-relaxed line-clamp-2 mb-3">
                          {saved.orgSummary}
                        </p>
                      )}

                      <div className="flex items-center gap-4 text-xs text-zinc-400 flex-wrap">
                        <span className="font-medium text-zinc-600">
                          {saved.grantCount} grants found
                        </span>
                        {shortlistCount > 0 && (
                          <span className="flex items-center gap-1 text-amber-600">
                            <Star className="w-3 h-3" />
                            {shortlistCount} shortlisted
                          </span>
                        )}
                        {totalApps > 0 && (
                          <span className="flex items-center gap-1 text-purple-600">
                            <FileText className="w-3 h-3" />
                            {activeApps > 0
                              ? `${activeApps} application${activeApps === 1 ? '' : 's'} in progress`
                              : `${totalApps} application${totalApps === 1 ? '' : 's'}`}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <CalendarDays className="w-3 h-3" />
                          Searched {searchDate}
                        </span>
                        <span>Created {savedDate}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 mt-0.5">
                      <button
                        onClick={e => handleDeleteClick(saved, e)}
                        disabled={hasActiveApps}
                        className={`p-1.5 rounded-lg transition-colors ${
                          hasActiveApps
                            ? 'text-zinc-200 cursor-not-allowed'
                            : 'text-zinc-300 hover:text-red-500 hover:bg-red-50'
                        }`}
                        title={hasActiveApps ? 'Cannot delete — applications in progress' : 'Delete'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      {saved.result.inputs && (
                        <button
                          onClick={e => handleRerun(saved, e)}
                          className="p-1.5 rounded-lg text-zinc-300 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                          title="Re-run search"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                      <div className="w-8 h-8 rounded-lg bg-teal-50 group-hover:bg-teal-100 flex items-center justify-center transition-colors">
                        <ArrowRight className="w-3.5 h-3.5 text-teal-600 group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Delete confirmation dialog ─────────────────────────────────────── */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl border border-zinc-200 w-full max-w-md mx-4 p-6"
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <h3 className="font-semibold text-zinc-900 text-base">Delete funding search?</h3>
                <p className="text-sm text-zinc-500 mt-1">
                  <strong>&ldquo;{confirmDelete.name}&rdquo;</strong> has{' '}
                  <strong>{getShortlistCount(confirmDelete.name)} shortlisted grant{getShortlistCount(confirmDelete.name) === 1 ? '' : 's'}</strong>.
                  Deleting this search will also remove the shortlisted grants associated with it.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl transition-colors"
              >
                Delete search
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
