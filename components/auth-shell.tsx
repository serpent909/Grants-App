'use client';

import { useId, useState } from 'react';
import { Eye, EyeOff, Loader2, Search, Star, ClipboardList } from 'lucide-react';

/**
 * Shared layout + form controls for the signed-out pages (login, signup,
 * invitation). Two columns on desktop: what the product does, and the form.
 */

const HIGHLIGHTS = [
  { icon: Search, title: 'Search once, see everything', text: 'Hundreds of NZ funders matched and ranked against your mission.' },
  { icon: Star, title: 'Shortlist with confidence', text: 'Deep research pulls deadlines, eligibility and the application checklist.' },
  { icon: ClipboardList, title: 'Track every application', text: 'From first draft to decision, with your documents alongside.' },
];

export function AuthShell({ title, subtitle, children, footer }: {
  title: string;
  subtitle: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-canvas flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-4xl grid lg:grid-cols-2 gap-10 items-center">
        {/* Value proposition — desktop only */}
        <div className="hidden lg:block">
          <h2 className="font-display text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 leading-tight">
            Grant funding search for{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-600 to-emerald-500">
              New Zealand
            </span>{' '}
            organisations
          </h2>
          <ul className="mt-8 space-y-5">
            {HIGHLIGHTS.map(({ icon: Icon, title: heading, text }) => (
              <li key={heading} className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-zinc-800 dark:text-zinc-200">{heading}</span>
                  <span className="block text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Form card */}
        <div className="w-full max-w-sm mx-auto">
          <div className="text-center lg:text-left mb-6">
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-display">{title}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{subtitle}</p>
          </div>
          <div className="bg-white dark:bg-zinc-800 rounded-2xl shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-700 p-6">
            {children}
          </div>
          {footer && (
            <p className="text-center text-sm text-zinc-500 dark:text-zinc-400 mt-6">{footer}</p>
          )}
        </div>
      </div>
    </div>
  );
}

const INPUT_CLASS =
  'w-full text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-zinc-50 dark:disabled:bg-zinc-800 disabled:text-zinc-500';

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'>;

/** Labelled text input (label is programmatically associated with the field). */
export function AuthField({ label, hint, ...props }: InputProps & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
        {label}
      </label>
      <input id={id} className={INPUT_CLASS} aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {hint && <p id={`${id}-hint`} className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">{hint}</p>}
    </div>
  );
}

/** Password input with a show/hide toggle. */
export function PasswordField({ label, hint, ...props }: InputProps & { label: string; hint?: string }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className={`${INPUT_CLASS} pr-10`}
          aria-describedby={hint ? `${id}-hint` : undefined}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
        >
          {visible ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
        </button>
      </div>
      {hint && <p id={`${id}-hint`} className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">{hint}</p>}
    </div>
  );
}

export function AuthError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950 rounded-lg px-3 py-2">
      {message}
    </p>
  );
}

export function AuthSubmit({ loading, icon: Icon, children }: {
  loading: boolean;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 rounded-lg shadow-sm transition-all disabled:opacity-60"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Icon className="w-4 h-4" aria-hidden />}
      {children}
    </button>
  );
}

/**
 * Where to send the user after signing in: the `next` query param set by the
 * proxy, but only if it is a same-site path (never an absolute or
 * protocol-relative URL — that would be an open redirect).
 */
export function postLoginDestination(): string {
  if (typeof window === 'undefined') return '/';
  const next = new URLSearchParams(window.location.search).get('next');
  if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) return next;
  return '/';
}
