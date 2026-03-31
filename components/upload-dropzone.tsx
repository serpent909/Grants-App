'use client';

import { useCallback, useState, useRef } from 'react';
import { Upload, Loader2, AlertCircle } from 'lucide-react';

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
]);

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

interface UploadDropzoneProps {
  onFiles: (files: File[]) => Promise<void>;
  compact?: boolean;
  className?: string;
}

export default function UploadDropzone({ onFiles, compact, className = '' }: UploadDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFiles = useCallback((files: File[]): File[] => {
    const valid: File[] = [];
    for (const file of files) {
      if (!ALLOWED_TYPES.has(file.type)) {
        setError(`"${file.name}" is not a supported file type. Use PDF, Word, Excel, JPEG, or PNG.`);
        return [];
      }
      if (file.size > MAX_SIZE) {
        setError(`"${file.name}" exceeds the 10MB size limit.`);
        return [];
      }
      valid.push(file);
    }
    return valid;
  }, []);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const files = validateFiles(Array.from(fileList));
    if (files.length === 0) return;

    setUploading(true);
    try {
      await onFiles(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [onFiles, validateFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  if (compact) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:border-teal-400 hover:text-teal-700 dark:hover:text-teal-400 transition-colors disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          Upload
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
        {error && (
          <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition-colors ${
          dragging
            ? 'border-teal-400 bg-teal-50/50 dark:bg-teal-950/30'
            : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 bg-white dark:bg-zinc-800'
        }`}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Uploading...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-6 h-6 text-zinc-400" />
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Drop files here or <span className="text-teal-600 dark:text-teal-400">browse</span>
            </p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">PDF, Word, Excel, JPEG, PNG — max 10MB</p>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
      {error && (
        <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      )}
    </div>
  );
}
