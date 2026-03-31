'use client';

import { useState } from 'react';
import { FileText, Image, Table, File, Download, Trash2, Pencil, X, Check, Loader2 } from 'lucide-react';
import { AppDocument } from '@/lib/types';
import { formatFileSize, fileTypeIcon, deleteDocument, updateDocument } from '@/lib/document-storage';
import {
  CATEGORY_GROUPS,
  getCategoryLabel,
  getCategoryGroup,
  isPredefinedCategory,
} from '@/lib/document-categories';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const FILE_ICONS = {
  pdf: FileText,
  word: FileText,
  excel: Table,
  image: Image,
  file: File,
} as const;

const FILE_COLORS = {
  pdf: 'text-red-500 bg-red-50',
  word: 'text-blue-500 bg-blue-50',
  excel: 'text-emerald-500 bg-emerald-50',
  image: 'text-purple-500 bg-purple-50',
  file: 'text-zinc-500 bg-zinc-50',
} as const;

interface DocumentCardProps {
  doc: AppDocument;
  /** All category IDs currently in use (for showing dynamic categories in edit dropdown) */
  dynamicCategories?: string[];
  onDeleted?: () => void;
}

export default function DocumentCard({ doc, dynamicCategories = [], onDeleted }: DocumentCardProps) {
  const [editing, setEditing] = useState(false);
  const [editFilename, setEditFilename] = useState(doc.filename);
  const [editCategory, setEditCategory] = useState(doc.category);
  const [editNotes, setEditNotes] = useState(doc.notes);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const typeKey = fileTypeIcon(doc.contentType);
  const Icon = FILE_ICONS[typeKey];
  const iconColors = FILE_COLORS[typeKey];
  const categoryLabel = getCategoryLabel(doc.category);

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/documents/download?id=${encodeURIComponent(doc.id)}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this document?')) return;
    setDeleting(true);
    await deleteDocument(doc.id);
    onDeleted?.();
  }

  async function handleSaveEdit() {
    await updateDocument(doc.id, {
      filename: editFilename !== doc.filename ? editFilename : undefined,
      category: editCategory,
      notes: editNotes,
    });
    setEditing(false);
  }

  // Dynamic categories that aren't predefined (for the dropdown)
  const customCats = dynamicCategories.filter(id => !isPredefinedCategory(id));

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-sm p-4">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${iconColors}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate" title={doc.filename}>
            {doc.filename}
          </h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-100">
              {categoryLabel}
            </span>
            <span className="text-xs text-zinc-400">{formatFileSize(doc.sizeBytes)}</span>
            <span className="text-xs text-zinc-400">
              {new Date(doc.uploadedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            {doc.usageCount !== undefined && doc.usageCount > 0 && (
              <span className="text-xs text-indigo-600 font-medium">
                Used in {doc.usageCount} item{doc.usageCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {doc.notes && !editing && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5 leading-relaxed">{doc.notes}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger
              onClick={handleDownload}
              disabled={downloading}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950 transition-colors"
            >
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            </TooltipTrigger>
            <TooltipContent>Download</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              onClick={() => { setEditing(!editing); setEditFilename(doc.filename); setEditCategory(doc.category); setEditNotes(doc.notes); }}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Pencil className="w-4 h-4" />
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              onClick={handleDelete}
              disabled={deleting}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {editing && (
        <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
          <div>
            <label className="text-[10px] text-zinc-400 font-medium uppercase block mb-1">Filename</label>
            <input
              type="text"
              value={editFilename}
              onChange={e => setEditFilename(e.target.value)}
              className="w-full text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-400 font-medium uppercase block mb-1">Category</label>
            <select
              value={editCategory}
              onChange={e => setEditCategory(e.target.value)}
              className="w-full text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            >
              {CATEGORY_GROUPS.map(grp => (
                <optgroup key={grp.group} label={grp.group}>
                  {grp.categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </optgroup>
              ))}
              {customCats.length > 0 && (
                <optgroup label="Custom">
                  {customCats.map(id => (
                    <option key={id} value={id}>{getCategoryLabel(id)}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-zinc-400 font-medium uppercase block mb-1">Notes</label>
            <input
              type="text"
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
              placeholder="Optional description..."
              className="w-full text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveEdit}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition-colors"
            >
              <Check className="w-3 h-3" /> Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 transition-colors"
            >
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
