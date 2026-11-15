'use client';

import { useState, useMemo, useEffect, useId } from 'react';
import { FileText, Loader2, FolderOpen, X, Upload, Search } from 'lucide-react';
import { useDocuments, uploadDocument, formatFileSize } from '@/lib/document-storage';
import {
  CATEGORY_GROUPS,
  CATEGORY_GROUP_ORDER,
  getCategoryGroup,
  getCategoryLabel,
  isPredefinedCategory,
} from '@/lib/document-categories';
import { errorMessage } from '@/lib/fetcher';
import { INPUT_CLASS } from '@/lib/grant-ui';
import UploadDropzone from '@/components/upload-dropzone';
import DocumentCard from '@/components/document-card';
import { PageShell, PageHeader, EmptyState, ListSkeleton, ErrorState } from '@/components/page-shell';
import { toast } from '@/components/toast';

export default function DocumentsPage() {
  const { data: documents = [], isLoading, error, mutate } = useDocuments();
  const [activeGroup, setActiveGroup] = useState<string | 'all'>('all');
  const [query, setQuery] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadCategory, setUploadCategory] = useState('other');
  const [uploading, setUploading] = useState(false);
  const dialogTitleId = useId();
  const categoryId = useId();

  // Group + text filtering
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter(d =>
      (activeGroup === 'all' || getCategoryGroup(d.category) === activeGroup) &&
      (!q || d.filename.toLowerCase().includes(q) || d.notes.toLowerCase().includes(q)),
    );
  }, [documents, activeGroup, query]);

  // Count documents per group
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const doc of documents) {
      const group = getCategoryGroup(doc.category);
      counts[group] = (counts[group] || 0) + 1;
    }
    return counts;
  }, [documents]);

  // Dynamic (non-predefined) category IDs for the edit / upload dropdowns
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
    let uploaded = 0;
    try {
      for (const file of pendingFiles) {
        await uploadDocument(file, { category: uploadCategory });
        uploaded++;
      }
      toast.success(uploaded === 1 ? 'Document uploaded' : `${uploaded} documents uploaded`);
    } catch (err) {
      // Earlier files in the batch are already saved — say so.
      toast.error(
        `${errorMessage(err, 'Upload failed.')}${uploaded > 0 ? ` (${uploaded} of ${pendingFiles.length} uploaded.)` : ''}`,
      );
    } finally {
      setUploading(false);
      setPendingFiles([]);
    }
  }

  // Escape closes the upload dialog
  const dialogOpen = pendingFiles.length > 0;
  useEffect(() => {
    if (!dialogOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !uploading) setPendingFiles([]);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen, uploading]);

  const pillClass = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
      active
        ? 'bg-teal-600 text-white'
        : 'bg-white dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700 text-zinc-600 dark:text-zinc-400 hover:ring-zinc-300 dark:hover:ring-zinc-600'
    }`;

  return (
    <PageShell>
      <PageHeader
        icon={FileText}
        title="Documents"
        subtitle={
          isLoading ? 'Loading…'
            : documents.length === 0 ? 'Your reusable library for grant applications'
            : `${documents.length} document${documents.length === 1 ? '' : 's'} ready to attach to applications`
        }
      />

      {/* Upload zone */}
      <UploadDropzone onFiles={handleFilesSelected} className="mb-6" />

      {isLoading ? (
        <ListSkeleton rows={3} />
      ) : error ? (
        <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
      ) : documents.length === 0 ? (
        <EmptyState icon={FolderOpen} title="No documents yet">
          Upload the documents funders ask for most — financial statements, your constitution,
          proof of charitable status — then attach them to any application checklist.
        </EmptyState>
      ) : (
        <>
          {/* Search + group filter */}
          <div className="flex items-center gap-3 flex-wrap mb-6">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search documents…"
                aria-label="Search documents"
                className={`${INPUT_CLASS} pl-9`}
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter by category group">
              <button type="button" onClick={() => setActiveGroup('all')} aria-pressed={activeGroup === 'all'} className={pillClass(activeGroup === 'all')}>
                All ({documents.length})
              </button>
              {visibleGroups.map(group => (
                <button
                  key={group}
                  type="button"
                  onClick={() => setActiveGroup(group)}
                  aria-pressed={activeGroup === group}
                  className={pillClass(activeGroup === group)}
                >
                  {group} ({groupCounts[group]})
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-white dark:bg-zinc-800 rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-700 py-12 text-center shadow-sm">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No documents match.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {filtered.map(doc => (
                <li key={doc.id}>
                  <DocumentCard doc={doc} dynamicCategories={dynamicCategories} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Category selection dialog for uploads */}
      {dialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => { if (!uploading) setPendingFiles([]); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            onClick={e => e.stopPropagation()}
            className="bg-white dark:bg-zinc-800 rounded-2xl shadow-xl ring-1 ring-zinc-200 dark:ring-zinc-700 w-full max-w-md p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 id={dialogTitleId} className="font-semibold text-zinc-900 dark:text-zinc-100">
                Upload document{pendingFiles.length > 1 ? 's' : ''}
              </h2>
              <button
                type="button"
                onClick={() => setPendingFiles([])}
                disabled={uploading}
                aria-label="Cancel upload"
                className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>

            <ul className="space-y-1.5 mb-4 max-h-40 overflow-y-auto">
              {pendingFiles.map((file, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 rounded-lg">
                  <FileText className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" aria-hidden />
                  <span className="truncate">{file.name}</span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-auto shrink-0">{formatFileSize(file.size)}</span>
                </li>
              ))}
            </ul>

            <div className="mb-5">
              <label htmlFor={categoryId} className="text-xs text-zinc-600 dark:text-zinc-400 font-medium block mb-1.5">Category</label>
              <select
                id={categoryId}
                value={uploadCategory}
                onChange={e => setUploadCategory(e.target.value)}
                className={INPUT_CLASS}
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

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingFiles([])}
                disabled={uploading}
                className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmUpload}
                disabled={uploading}
                autoFocus
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <Upload className="w-3 h-3" aria-hidden />}
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
