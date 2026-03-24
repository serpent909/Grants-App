'use client';

import { SessionProvider } from 'next-auth/react';
import { SWRConfig } from 'swr';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

export default function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const onError = useCallback(
    (error: Error) => {
      if (error.message === '401') {
        router.push('/login');
      }
    },
    [router],
  );

  const fetcher = useCallback(async (url: string) => {
    const res = await fetch(url);
    if (res.status === 401) {
      throw new Error('401');
    }
    if (!res.ok) {
      throw new Error(`${res.status}`);
    }
    return res.json();
  }, []);

  return (
    <SessionProvider>
      <SWRConfig value={{ fetcher, onError }}>
        {children}
      </SWRConfig>
    </SessionProvider>
  );
}
