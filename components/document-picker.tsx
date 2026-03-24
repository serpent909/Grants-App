'use client';

import { useState, useMemo } from 'react';
import { Search, FileText, Image, Table, File, X, Upload } from 'lucide-react';
import { useDocuments } from '@/lib/document-storage';
import { formatFileSize, fileTypeIcon } from '@/lib/document-storage';
import {
  CATEGORY_GROUP_ORDER,
  getCategoryLabel,
  getCategoryGroup,
} from '@/lib/document-categories';
import { AppDocument } from '@/lib/types';

const FILE_ICONS = {
  pdf: FileText,
  word: FileText,
  excel: Table,
  image: Image,
  file: File,
} as const;

interface DocumentPickerProps {
  onSelect: (doc: AppDocument) => void;
  onUploadNew: () => void;
  onClose: () => void;
  excludeIds?: Set<string>;
}

export default function DocumentPicker({ onSelect, onUploadNew, onClose, excludeIds }: DocumentPickerProps) {
  const { data: documents = [] } = useDocuments();
  const [search, setSearch] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | 'all'>('all');

  // Determine which groups have documents
  const groupsWithDocs = useMemo(() => {
    const groups = new Set<string>();
    for (const doc of documents) {
      if (!excludeIds?.has(doc.id)) {
        groups.add(getCategoryGroup(doc.category));
      }
    }
    return groups;
  }, [documents, excludeIds]);

  const filtered = useMemo(() => {
    let docs = documents.filter(d => !excludeIds?.has(d.id));
    if (activeGroup !== 'all') {
      docs = docs.filter(d => getCategoryGroup(d.category) === activeGroup);
    }
    if (search) {
      const q = search.toLowerCase();
      docs = docs.filter(d => d.filename.toLowerCase().includes(q) || d.notes.toLowerCase().includes(q));
    }
    return docs;
  }, [documents, search, activeGroup, excludeIds]);

  // All group names in order, plus Custom if any exist
  const visibleGroups = useMemo((): string[] => {
    const ordered: string[] = [...CATEGORY_GROUP_ORDER].filter(g => groupsWithDocs.has(g));
    if (groupsWithDocs.has('Custom')) ordered.push('Custom');
    return ordered;
  }, [groupsWithDocs]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl border border-zinc-200 w-full max-w-lg mx-4 max-h-[70vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="font-semibold text-zinc-900">Attach Document</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Upload new shortcut */}
        <div className="px-5 pb-3">
          <button
            onClick={onUploadNew}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-zinc-300 text-sm font-medium text-teal-600 hover:border-teal-400 hover:bg-teal-50/50 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Upload new document
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search documents..."
              className="w-full text-sm border border-zinc-200 rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              autoFocus
            />
          </div>
        </div>

        {/* Group filter tabs */}
        {visibleGroups.length > 0 && (
          <div className="px-5 pb-3 flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setActiveGroup('all')}
              className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                activeGroup === 'all' ? 'bg-teal-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
              }`}
            >
              All
            </button>
            {visibleGroups.map(group => (
              <button
                key={group}
                onClick={() => setActiveGroup(group)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                  activeGroup === group ? 'bg-teal-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                }`}
              >
                {group}
              </button>
            ))}
          </div>
        )}

        {/* Document list */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {filtered.length === 0 ? (
            <p className="text-sm text-zinc-400 text-center py-8">
              {documents.length === 0 ? 'No documents in your library yet.' : 'No matching documents.'}
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map(doc => {
                const typeKey = fileTypeIcon(doc.contentType);
                const Icon = FILE_ICONS[typeKey];
                const catLabel = getCategoryLabel(doc.category);
                return (
                  <button
                    key={doc.id}
                    onClick={() => onSelect(doc)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-teal-50 transition-colors text-left group"
                  >
                    <Icon className="w-4 h-4 text-zinc-400 group-hover:text-teal-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-800 truncate">{doc.filename}</p>
                      <p className="text-xs text-zinc-400">
                        {catLabel} · {formatFileSize(doc.sizeBytes)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
