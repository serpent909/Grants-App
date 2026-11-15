import { AlertCircle } from 'lucide-react';

/**
 * Shared page chrome: one canvas, one header layout, one empty / loading /
 * error treatment — so every list page looks and behaves the same.
 */

export function PageShell({ children, width = 'max-w-6xl' }: {
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-canvas">
      <div className={`${width} mx-auto px-4 sm:px-6 py-8 sm:py-12`}>{children}</div>
    </div>
  );
}

export function PageHeader({ icon: Icon, iconClass, title, subtitle, actions }: {
  icon: React.ElementType;
  /** Tailwind classes for the icon tile, e.g. amber for Shortlisted. */
  iconClass?: string;
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 flex-wrap mb-6">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          iconClass ?? 'bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400'
        }`}>
          <Icon className="w-4.5 h-4.5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-display">{title}</h1>
          {subtitle && <p className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: {
  icon: React.ElementType;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-zinc-800 rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-700 px-6 py-16 text-center shadow-sm">
      <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center">
        <Icon className="w-5 h-5 text-zinc-400 dark:text-zinc-400" aria-hidden />
      </div>
      <p className="font-semibold text-zinc-700 dark:text-zinc-200 text-sm">{title}</p>
      {children && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm mx-auto leading-relaxed">{children}</p>
      )}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

/** Skeleton rows shown while a list loads — keeps the layout from jumping. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 p-5 animate-pulse"
        >
          <div className="h-4 w-1/3 rounded bg-zinc-200 dark:bg-zinc-700 mb-3" />
          <div className="h-3 w-2/3 rounded bg-zinc-100 dark:bg-zinc-700/60" />
        </div>
      ))}
    </div>
  );
}

/** Shown when a page's data could not be loaded (as opposed to being empty). */
export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="bg-white dark:bg-zinc-800 rounded-2xl ring-1 ring-red-200 dark:ring-red-900 px-6 py-12 text-center shadow-sm"
    >
      <AlertCircle className="w-8 h-8 mx-auto mb-3 text-red-400" aria-hidden />
      <p className="font-semibold text-zinc-800 dark:text-zinc-100 text-sm">We couldn&apos;t load this page</p>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
        {message || 'Something went wrong. Please try again.'}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex items-center px-4 py-2 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}
