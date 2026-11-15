'use client';

import { useSyncExternalStore } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

/**
 * Minimal toast notifications — no dependency, callable from anywhere:
 *
 *   toast.success('Saved');
 *   toast.error('Could not save your notes');
 *
 * Render <Toaster /> once near the root.
 */

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
}

const MAX_VISIBLE = 4;
const DURATION_MS: Record<ToastTone, number> = { success: 3500, info: 4500, error: 7000 };

let items: ToastItem[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
const EMPTY: ToastItem[] = [];

function emit() {
  for (const listener of listeners) listener();
}

function dismiss(id: string) {
  items = items.filter(t => t.id !== id);
  emit();
}

function push(tone: ToastTone, message: string) {
  // Collapse repeats — a burst of identical failures shows one toast.
  if (items.some(t => t.tone === tone && t.message === message)) return;
  const id = String(++nextId);
  items = [...items, { id, tone, message }].slice(-MAX_VISIBLE);
  emit();
  setTimeout(() => dismiss(id), DURATION_MS[tone]);
}

export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
  info: (message: string) => push('info', message),
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const TONE_STYLES: Record<ToastTone, { icon: React.ElementType; iconClass: string }> = {
  success: { icon: CheckCircle2, iconClass: 'text-emerald-500' },
  error: { icon: AlertCircle, iconClass: 'text-red-500' },
  info: { icon: Info, iconClass: 'text-teal-500' },
};

export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, () => items, () => EMPTY);

  return (
    <div
      className="fixed bottom-4 right-4 left-4 sm:left-auto z-[100] flex flex-col items-end gap-2 pointer-events-none"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map(t => {
        const { icon: Icon, iconClass } = TONE_STYLES[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto w-full sm:w-auto sm:max-w-sm flex items-start gap-3 rounded-xl bg-white dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-lg shadow-black/10 px-4 py-3 animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconClass}`} aria-hidden />
            <p className="text-sm text-zinc-800 dark:text-zinc-100 leading-snug">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="ml-auto -mr-1 p-0.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
