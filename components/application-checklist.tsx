'use client';

import { useState, useCallback, useRef } from 'react';
import {
  ClipboardList, CheckCircle2, Circle, Loader2,
  Paperclip, X, Plus, Upload, FolderOpen,
} from 'lucide-react';
import { useChecklist, initializeChecklist, toggleChecklistItem, attachDocumentToChecklist, detachDocumentFromChecklist } from '@/lib/checklist-storage';
import { uploadDocument, downloadDocument, formatFileSize } from '@/lib/document-storage';
import { errorMessage } from '@/lib/fetcher';
import { UPLOAD_ACCEPT } from '@/lib/upload-rules';
import { PRIMARY_BUTTON_CLASS } from '@/lib/grant-ui';
import { RequiredTag } from '@/components/grant/deep-search-details';
import { toast } from '@/components/toast';
import { ChecklistItem, AppDocument } from '@/lib/types';
import DocumentPicker from './document-picker';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface ApplicationChecklistProps {
  grantId: string;
  hasDeepSearch: boolean;
}

export default function ApplicationChecklist({ grantId, hasDeepSearch }: ApplicationChecklistProps) {
  const { data: items, isLoading } = useChecklist(grantId);
  const [initializing, setInitializing] = useState(false);
  const [pickerItemId, setPickerItemId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);

  const handleInitialize = useCallback(async () => {
    setInitializing(true);
    try {
      await initializeChecklist(grantId);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not create the checklist.'));
    } finally {
      setInitializing(false);
    }
  }, [grantId]);

  const handleToggle = useCallback(async (item: ChecklistItem) => {
    try {
      await toggleChecklistItem(item.id, !item.checked, grantId);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the checklist.'));
    }
  }, [grantId]);

  const handleUploadForItem = useCallback(async (itemId: string, file: File, itemName: string) => {
    setUploadingItemId(itemId);
    try {
      const doc = await uploadDocument(file, { checklistItemName: itemName });
      await attachDocumentToChecklist(itemId, doc.id);
    } catch (err) {
      toast.error(errorMessage(err, 'Upload failed.'));
    } finally {
      setUploadingItemId(null);
      setOpenMenuId(null);
    }
  }, []);

  const handleAttachExisting = useCallback(async (itemId: string, doc: AppDocument) => {
    try {
      await attachDocumentToChecklist(itemId, doc.id);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not attach the document.'));
    } finally {
      setPickerItemId(null);
    }
  }, []);

  const handleDetach = useCallback(async (itemId: string, docId: string) => {
    try {
      await detachDocumentFromChecklist(itemId, docId);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not remove the document.'));
    }
  }, []);

  const handleDownload = useCallback(async (docId: string, filename: string) => {
    try {
      await downloadDocument(docId, filename);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not download this document.'));
    }
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <Loader2 className="w-4 h-4 text-teal-600 animate-spin" />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Loading checklist…</span>
      </div>
    );
  }

  // No checklist initialized yet
  if (!items || items.length === 0) {
    if (!hasDeepSearch) {
      return (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          Run a Deep Search on this grant from its funding search to generate a checklist of
          everything the funder asks for.
        </p>
      );
    }
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 text-center">
        <ClipboardList className="w-6 h-6 mx-auto mb-2 text-zinc-300" />
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
          Deep Search found what this funder asks for. Create a checklist to track it.
        </p>
        <button
          onClick={handleInitialize}
          disabled={initializing}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg ${PRIMARY_BUTTON_CLASS}`}
        >
          {initializing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardList className="w-3 h-3" />}
          Create checklist
        </button>
      </div>
    );
  }

  const checked = items.filter(i => i.checked).length;
  const requiredTotal = items.filter(i => i.required).length;
  const requiredChecked = items.filter(i => i.required && i.checked).length;
  const progressPct = Math.round((checked / items.length) * 100);

  return (
    <div>
      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            {checked}/{items.length} complete
          </span>
          {requiredTotal > 0 && (
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {requiredChecked}/{requiredTotal} required
            </span>
          )}
        </div>
        <div className="w-full h-2 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct} aria-label="Checklist progress">
          <div
            className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Checklist items */}
      <div className="space-y-2">
        {items.map(item => {
          const isUploading = uploadingItemId === item.id;

          return (
            <div key={item.id} className={`rounded-lg border p-3 transition-colors ${item.checked ? 'bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800' : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700'}`}>
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={item.checked}
                  aria-label={item.itemName}
                  onClick={() => handleToggle(item)}
                  className="mt-0.5 flex-shrink-0 rounded-full"
                >
                  {item.checked ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <Circle className="w-5 h-5 text-zinc-300 hover:text-teal-400 transition-colors" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  {/* Item header */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${item.checked ? 'text-zinc-500 dark:text-zinc-400 line-through' : 'text-zinc-800 dark:text-zinc-200'}`}>
                      {item.itemName}
                    </span>
                    <RequiredTag required={item.required} />
                  </div>

                  {item.description && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">{item.description}</p>
                  )}

                  {/* Attached documents */}
                  {item.documents.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      {item.documents.map(doc => (
                        <div
                          key={doc.id}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-xs group"
                        >
                          <Paperclip className="w-3 h-3 text-zinc-400" />
                          <button
                            onClick={() => handleDownload(doc.id, doc.filename)}
                            className="font-medium text-zinc-700 dark:text-zinc-300 hover:text-teal-600 transition-colors truncate max-w-[150px]"
                            title={doc.filename}
                          >
                            {doc.filename}
                          </button>
                          <span className="text-zinc-400">{formatFileSize(doc.sizeBytes)}</span>
                          <Tooltip>
                            <TooltipTrigger
                              onClick={() => handleDetach(item.id, doc.id)}
                              aria-label={`Remove ${doc.filename}`}
                              className="p-0.5 rounded text-zinc-400 hover:text-red-500 opacity-60 group-hover:opacity-100 focus-visible:opacity-100 transition-all"
                            >
                              <X className="w-3 h-3" />
                            </TooltipTrigger>
                            <TooltipContent>Remove</TooltipContent>
                          </Tooltip>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add document */}
                  <div className="mt-2 relative">
                    {isUploading ? (
                      <span className="inline-flex items-center gap-1 text-xs text-teal-600">
                        <Loader2 className="w-3 h-3 animate-spin" /> Uploading...
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setOpenMenuId(openMenuId === item.id ? null : item.id)}
                          aria-expanded={openMenuId === item.id}
                          className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
                        >
                          <Plus className="w-3 h-3" /> Add document
                        </button>

                        {openMenuId === item.id && (
                          <div className="absolute left-0 top-full mt-1 z-20 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 py-1 w-48">
                            <button
                              onClick={() => {
                                uploadRef.current?.setAttribute('data-item-id', item.id);
                                uploadRef.current?.setAttribute('data-item-name', item.itemName);
                                uploadRef.current?.click();
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-teal-50 dark:hover:bg-teal-950 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
                            >
                              <Upload className="w-3.5 h-3.5" /> Upload new
                            </button>
                            <button
                              onClick={() => { setPickerItemId(item.id); setOpenMenuId(null); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-teal-50 dark:hover:bg-teal-950 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
                            >
                              <FolderOpen className="w-3.5 h-3.5" /> From library
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Hidden file input for uploads */}
      <input
        ref={uploadRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="hidden"
        onChange={async e => {
          const file = e.target.files?.[0];
          const itemId = uploadRef.current?.getAttribute('data-item-id');
          const itemName = uploadRef.current?.getAttribute('data-item-name') || '';
          if (file && itemId) {
            await handleUploadForItem(itemId, file, itemName);
          }
          e.target.value = '';
        }}
      />

      {/* Document picker modal */}
      {pickerItemId && (
        <DocumentPicker
          onSelect={doc => handleAttachExisting(pickerItemId, doc)}
          onUploadNew={() => {
            setPickerItemId(null);
            const item = items.find(i => i.id === pickerItemId);
            if (item) {
              uploadRef.current?.setAttribute('data-item-id', item.id);
              uploadRef.current?.setAttribute('data-item-name', item.itemName);
              uploadRef.current?.click();
            }
          }}
          onClose={() => setPickerItemId(null)}
          excludeIds={new Set(items.find(i => i.id === pickerItemId)?.documents.map(d => d.id))}
        />
      )}
    </div>
  );
}
