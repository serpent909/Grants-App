'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import { Loader2, MailX, MailCheck } from 'lucide-react';
import { AuthShell } from '@/components/auth-shell';
import { apiFetch, json, errorMessage } from '@/lib/fetcher';
import { LINK_CLASS } from '@/lib/grant-ui';

export default function VerifyEmailPage() {
  const { token } = useParams<{ token: string }>();
  const { status } = useSession();

  // The endpoint is idempotent, so a repeated call (e.g. reopening the link)
  // still reports success. Failure is rendered below rather than as a toast.
  const result = useSWR(
    ['verify-email', token],
    () => apiFetch('/api/auth/verify-email', json('POST', { token })),
    { revalidateOnFocus: false, revalidateOnReconnect: false, onError: () => {} },
  );

  if (result.isLoading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-canvas flex items-center justify-center" role="status" aria-label="Confirming your email address">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" aria-hidden />
      </div>
    );
  }

  const signedIn = status === 'authenticated';

  if (result.error) {
    return (
      <AuthShell title="Verification link unavailable" subtitle="We couldn’t confirm your email address with this link">
        <div className="text-center py-2">
          <MailX className="w-8 h-8 mx-auto mb-3 text-zinc-300 dark:text-zinc-600" aria-hidden />
          <p role="alert" className="text-sm text-zinc-700 dark:text-zinc-300 mb-1">
            {errorMessage(result.error)}
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            Sign in and use “Resend email” at the top of the page to get a new link.
          </p>
          <Link href={signedIn ? '/' : '/login'} className={`text-sm ${LINK_CLASS}`}>
            {signedIn ? 'Continue to GrantSearch' : 'Go to sign in'}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Email confirmed" subtitle="Thanks — your email address is verified">
      <div role="status" className="text-center py-2">
        <MailCheck className="w-8 h-8 mx-auto mb-3 text-teal-600 dark:text-teal-400" aria-hidden />
        <Link href={signedIn ? '/' : '/login'} className={`text-sm ${LINK_CLASS}`}>
          {signedIn ? 'Continue to GrantSearch' : 'Go to sign in'}
        </Link>
      </div>
    </AuthShell>
  );
}
