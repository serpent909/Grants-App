'use client';

import { useId } from 'react';

/**
 * Labelled form field. Rendered as a <fieldset> with a <legend> so the label
 * is announced for single inputs and for groups (toggle pills, selects) alike.
 */
export function Field({ label, required, error, hint, children }: {
  label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode;
}) {
  const messageId = useId();
  return (
    <fieldset className="space-y-1.5 min-w-0" aria-describedby={error || hint ? messageId : undefined}>
      <legend className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200 font-display mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-1" aria-hidden>*</span>}
        {required && <span className="sr-only"> (required)</span>}
      </legend>
      {children}
      {error && <p id={messageId} role="alert" className="text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>}
      {hint && !error && <p id={messageId} className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </fieldset>
  );
}
