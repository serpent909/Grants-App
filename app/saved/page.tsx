'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bookmark, Trash2, ArrowRight, Search, CalendarDays, RotateCcw, History } from 'lucide-react';
import { listSaved, deleteSaved, SavedSearch } from '@/lib/saved-searches';
import { getMarket } from '@/lib/markets';

export default function SavedPage() {
  const router = useRouter();
  const [searches, setSearches] = useState<SavedSearch[]>(() => listSaved());

  function handleOpen(saved: SavedSearch) {
    sessionStorage.setItem('grantSearchResult', JSON.stringify(saved.result));
    router.push(`/results?saved=${saved.id}`);
  }

  function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    deleteSaved(id);
    setSearches(listSaved());
  }

  function handleRerun(saved: SavedSearch, e: React.MouseEvent) {
    e.stopPropagation();
    if (saved.result.inputs) {
      sessionStorage.setItem('grantSearchPrefill', JSON.stringify(saved.result.inputs));
    }
    router.push('/');
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

                      <div className="flex items-center gap-4 text-xs text-zinc-400">
                        <span className="font-medium text-zinc-600">
                          {saved.grantCount} grants found
                        </span>
                        <span className="flex items-center gap-1">
                          <CalendarDays className="w-3 h-3" />
                          Searched {searchDate}
                        </span>
                        <span>Created {savedDate}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 mt-0.5">
                      <button
                        onClick={e => handleDelete(saved.id, e)}
                        className="p-1.5 rounded-lg text-zinc-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Delete"
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
    </div>
  );
}
