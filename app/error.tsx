'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';

/** Route-level error boundary: a rendering error shows this instead of a blank page. */
export default function RouteError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-canvas flex items-center justify-center px-4">
      <div role="alert" className="w-full max-w-md bg-white dark:bg-zinc-800 rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-sm p-8 text-center">
        <AlertCircle className="w-9 h-9 mx-auto mb-4 text-red-400" aria-hidden />
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 font-display">Something went wrong</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
          This page hit an unexpected problem. Your data is safe — try again, or head back to your searches.
        </p>
        {error.digest && (
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-3 font-mono">Reference: {error.digest}</p>
        )}
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-colors"
          >
            Try again
          </button>
          <Link
            href="/saved"
            className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-xl transition-colors"
          >
            My searches
          </Link>
        </div>
      </div>
    </div>
  );
}
