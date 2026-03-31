'use client';

import { useState, useMemo } from 'react';
import { FileText, Loader2, FolderOpen, X, Upload } from 'lucide-react';
import { useDocuments, uploadDocument } from '@/lib/document-storage';
import {
  CATEGORY_GROUPS,
  CATEGORY_GROUP_ORDER,
  getCategoryGroup,
  getCategoryLabel,
  isPredefinedCategory,
} from '@/lib/document-categories';
import UploadDropzone from '@/components/upload-dropzone';
import DocumentCard from '@/components/document-card';

export default function DocumentsPage() {
  const { data: documents = [], isLoading } = useDocuments();
  const [activeGroup, setActiveGroup] = useState<string | 'all'>('all');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadCategory, setUploadCategory] = useState('other');
  const [uploading, setUploading] = useState(false);

  // Group-based filtering
  const filtered = useMemo(() => {
    if (activeGroup === 'all') return documents;
    return documents.filter(d => getCategoryGroup(d.category) === activeGroup);
  }, [documents, activeGroup]);

  // Count documents per group
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const doc of documents) {
      const group = getCategoryGroup(doc.category);
      counts[group] = (counts[group] || 0) + 1;
    }
    return counts;
  }, [documents]);

  // Collect dynamic category IDs for the document card edit dropdown
  const dynamicCategories = useMemo(() => {
    const dynamic = new Set<string>();
    for (const doc of documents) {
      if (!isPredefinedCategory(doc.category)) dynamic.add(doc.category);
    }
    return Array.from(dynamic);
  }, [documents]);

  // Visible groups (only those with documents)
  const visibleGroups = useMemo((): string[] => {
    const ordered: string[] = [...CATEGORY_GROUP_ORDER].filter(g => groupCounts[g]);
    if (groupCounts['Custom']) ordered.push('Custom');
    return ordered;
  }, [groupCounts]);

  async function handleFilesSelected(files: File[]) {
    setPendingFiles(files);
    setUploadCategory('other');
  }

  async function handleConfirmUpload() {
    setUploading(true);
    try {
      for (const file of pendingFiles) {
        await uploadDocument(file, { category: uploadCategory as string });
      }
    } finally {
      setUploading(false);
      setPendingFiles([]);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f7f5f0] dark:bg-zinc-900 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f5f0] dark:bg-zinc-900">
      <div className="max-w-6xl mx-auto px-6 py-12">

        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 bg-teal-50 dark:bg-teal-950 rounded-xl flex items-center justify-center">
            <FileText className="w-4 h-4 text-teal-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Documents</h1>
            <p className="text-sm text-zinc-500">
              {documents.length === 0
                ? 'No documents yet'
                : `${documents.length} document${documents.length === 1 ? '' : 's'}`
              }
            </p>
          </div>
        </div>

        {/* Upload zone */}
        <UploadDropzone onFiles={handleFilesSelected} className="mb-6" />

        {/* Group filter pills */}
        {documents.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-6">
            <button
              onClick={() => setActiveGroup('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                activeGroup === 'all'
                  ? 'bg-teal-600 text-white'
                  : 'bg-white dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700 text-zinc-600 dark:text-zinc-400 hover:ring-zinc-300 dark:hover:ring-zinc-600'
              }`}
            >
              All ({documents.length})
            </button>
            {visibleGroups.map(group => (
              <button
                key={group}
                onClick={() => setActiveGroup(group)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  activeGroup === group
                    ? 'bg-teal-600 text-white'
                    : 'bg-white dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700 text-zinc-600 dark:text-zinc-400 hover:ring-zinc-300 dark:hover:ring-zinc-600'
                }`}
              >
                {group} ({groupCounts[group]})
              </button>
            ))}
          </div>
        )}

        {/* Document list */}
        {documents.length === 0 ? (
          <div className="bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 py-20 text-center shadow-sm">
            <FolderOpen className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
            <p className="font-semibold text-zinc-400 text-sm">No documents yet</p>
            <p className="text-xs text-zinc-400 mt-1">
              Upload documents above or attach them from an application checklist.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 py-12 text-center shadow-sm">
            <p className="text-sm text-zinc-400">No documents in this group.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(doc => (
              <DocumentCard key={doc.id} doc={doc} dynamicCategories={dynamicCategories} />
            ))}
          </div>
        )}
      </div>

      {/* Category selection dialog for uploads */}
      {pendingFiles.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setPendingFiles([])}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-white dark:bg-zinc-800 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-md mx-4 p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Upload Document{pendingFiles.length > 1 ? 's' : ''}</h3>
              <button
                onClick={() => setPendingFiles([])}
                className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* File list */}
            <div className="space-y-1.5 mb-4">
              {pendingFiles.map((file, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 rounded-lg">
                  <FileText className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                  <span className="truncate">{file.name}</span>
                  <span className="text-xs text-zinc-400 ml-auto shrink-0">
                    {(file.size / 1024).toFixed(0)} KB
                  </span>
                </div>
              ))}
            </div>

            {/* Category selector */}
            <div className="mb-5">
              <label className="text-xs text-zinc-500 dark:text-zinc-400 font-medium block mb-1.5">Category</label>
              <select
                value={uploadCategory}
                onChange={e => setUploadCategory(e.target.value)}
                className="w-full text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              >
                {CATEGORY_GROUPS.map(grp => (
                  <optgroup key={grp.group} label={grp.group}>
                    {grp.categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.label}</option>
                    ))}
                  </optgroup>
                ))}
                {dynamicCategories.length > 0 && (
                  <optgroup label="Custom">
                    {dynamicCategories.map(id => (
                      <option key={id} value={id}>{getCategoryLabel(id)}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setPendingFiles([])}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmUpload}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                Upload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
