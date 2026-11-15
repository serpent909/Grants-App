'use client';

import { useEffect, useId, useRef } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Body content — plain text or richer JSX. */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' styles the confirm button red (destructive actions). */
  tone?: 'danger' | 'default';
  /** Shows a spinner and disables both buttons while the action runs. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible confirmation modal: labelled dialog, Escape to cancel, focus moves
 * to the safe (cancel) action on open and returns to the trigger on close.
 * Replaces window.confirm() and the hand-rolled modals that had drifted apart.
 */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Keep the latest callback/flag in a ref so the focus effect below depends
  // only on `open`. (Callers pass inline handlers; depending on them would
  // re-run the effect — and yank focus back to Cancel — on every render.)
  const latest = useRef({ onCancel, busy });
  useEffect(() => {
    latest.current = { onCancel, busy };
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !latest.current.busy) latest.current.onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const danger = tone === 'danger';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={() => { if (!busy) onCancel(); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-zinc-800 rounded-2xl shadow-xl ring-1 ring-zinc-200 dark:ring-zinc-700 w-full max-w-md p-6 animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-center gap-3 mb-4">
          {danger && (
            <div className="w-10 h-10 bg-red-50 dark:bg-red-950 rounded-xl flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-500" aria-hidden />
            </div>
          )}
          <h2 id={titleId} className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        </div>

        {children && (
          <div className="text-sm text-zinc-600 dark:text-zinc-400 mb-5 space-y-3">{children}</div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white rounded-lg transition-colors disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'
            }`}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
