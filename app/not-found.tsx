import Link from 'next/link';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-canvas flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-800 rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-sm p-8 text-center">
        <Compass className="w-9 h-9 mx-auto mb-4 text-teal-500" aria-hidden />
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 font-display">Page not found</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
          That page doesn&apos;t exist or may have been moved.
        </p>
        <Link
          href="/"
          className="inline-flex mt-6 px-4 py-2 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-colors"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
