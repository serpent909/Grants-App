'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bookmark, Trash2, ArrowRight, Search, CalendarDays,
  RotateCcw, History, Loader2, Star, FileText, AlertTriangle,
} from 'lucide-react';
import { useSavedSearches, deleteSaved, SavedSearch } from '@/lib/saved-searches';
import { useShortlistedBySearch } from '@/lib/shortlist-storage';
import { useApplicationsByStatus } from '@/lib/application-storage';
import { getMarket } from '@/lib/markets';
import { GrantApplication } from '@/lib/types';

export default function SavedPage() {
  const router = useRouter();
  const { data: searches = [], isLoading } = useSavedSearches();
  const { data: shortlistGroups = {} } = useShortlistedBySearch();
  const { data: appsByStatus } = useApplicationsByStatus();
  const [deleteConfirm, setDeleteConfirm] = useState<SavedSearch | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Flatten all applications and group by searchTitle
  const appsBySearch: Record<string, GrantApplication[]> = {};
  if (appsByStatus) {
    for (const apps of Object.values(appsByStatus)) {
      for (const app of apps) {
        const key = app.searchTitle || '';
        if (!appsBySearch[key]) appsBySearch[key] = [];
        appsBySearch[key].push(app);
      }
    }
  }

  function getShortlistCount(name: string): number {
    return shortlistGroups[name]?.length ?? 0;
  }

  function getAppCount(name: string): number {
    return appsBySearch[name]?.length ?? 0;
  }

  function handleOpen(saved: SavedSearch) {
    sessionStorage.setItem('grantSearchResult', JSON.stringify(saved.result));
    router.push(`/results?saved=${saved.id}`);
  }

  function handleDeleteClick(saved: SavedSearch, e: React.MouseEvent) {
    e.stopPropagation();
    const shortlisted = getShortlistCount(saved.name);
    const apps = getAppCount(saved.name);
    if (shortlisted > 0 || apps > 0) {
      setDeleteConfirm(saved);
    } else {
      confirmDelete(saved);
    }
  }

  async function confirmDelete(saved: SavedSearch) {
    setDeleting(true);
    await deleteSaved(saved.id);
    setDeleting(false);
    setDeleteConfirm(null);
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
              const shortlisted = getShortlistCount(saved.name);
              const apps = getAppCount(saved.name);

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

                      <div className="flex items-center gap-3 text-xs text-zinc-400 flex-wrap">
                        <span className="font-medium text-zinc-600">
                          {saved.grantCount} grants found
                        </span>
                        {shortlisted > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100 font-medium">
                            <Star className="w-3 h-3" />
                            {shortlisted} shortlisted
                          </span>
                        )}
                        {apps > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 font-medium">
                            <FileText className="w-3 h-3" />
                            {apps} application{apps === 1 ? '' : 's'}
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
                        className="p-1.5 rounded-lg text-zinc-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      {saved.result.inputs && (
                        <button
                          onClick={e => handleRerun(saved, e)}
                          className="p-1.5 rounded-lg text-zinc-300 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                          title="Edit & re-run search"
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

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl border border-zinc-200 w-full max-w-md mx-4 p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="font-semibold text-zinc-900">Delete search?</h3>
            </div>

            <p className="text-sm text-zinc-600 mb-3">
              <span className="font-medium">&ldquo;{deleteConfirm.name}&rdquo;</span> has linked data:
            </p>

            <div className="space-y-1.5 mb-5">
              {getShortlistCount(deleteConfirm.name) > 0 && (
                <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                  <Star className="w-3.5 h-3.5" />
                  {getShortlistCount(deleteConfirm.name)} shortlisted grant{getShortlistCount(deleteConfirm.name) === 1 ? '' : 's'}
                </div>
              )}
              {getAppCount(deleteConfirm.name) > 0 && (
                <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 px-3 py-2 rounded-lg">
                  <FileText className="w-3.5 h-3.5" />
                  {getAppCount(deleteConfirm.name)} application{getAppCount(deleteConfirm.name) === 1 ? '' : 's'} in progress
                </div>
              )}
            </div>

            <p className="text-xs text-zinc-500 mb-5">
              Deleting this search will only remove the search itself. Your shortlisted grants and applications will not be affected.
            </p>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmDelete(deleteConfirm)}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                Delete search
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
