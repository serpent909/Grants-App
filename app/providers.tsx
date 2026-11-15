'use client';

import { SessionProvider } from 'next-auth/react';
import { SWRConfig } from 'swr';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster, toast } from '@/components/toast';
import { ApiRequestError, errorMessage } from '@/lib/fetcher';

/**
 * Global handler for failed data loads. `apiFetch` already redirects to login
 * on a 401, so those are skipped here; everything else becomes a toast instead
 * of a page that quietly renders as if it were empty.
 */
function onSwrError(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 401) return;
  toast.error(errorMessage(error, 'Could not load your data. Please refresh the page.'));
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <SWRConfig value={{ onError: onSwrError, shouldRetryOnError: false }}>
          {children}
          <Toaster />
        </SWRConfig>
      </ThemeProvider>
    </SessionProvider>
  );
}
