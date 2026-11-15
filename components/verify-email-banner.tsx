'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { Loader2, Mail, X } from 'lucide-react';
import { apiFetch, errorMessage, AUTH_PAGES } from '@/lib/fetcher';
import { toast } from '@/components/toast';

interface VerificationStatus {
  email: string;
  verified: boolean;
}

/**
 * A slim reminder for signed-in users who have not yet confirmed their email
 * address. It only nudges — nothing in the app is blocked — and can be
 * dismissed until the next visit.
 */
export default function VerifyEmailBanner() {
  const pathname = usePathname();
  const { status } = useSession();
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const active = status === 'authenticated' && !AUTH_PAGES.some(p => pathname.startsWith(p));

  // Revalidates on focus, so the banner clears itself once the link has been
  // opened in another tab. It is not essential: a failed check stays silent.
  const { data } = useSWR<VerificationStatus>(
    active ? 'account:email-verification' : null,
    () => apiFetch<VerificationStatus>('/api/account/email-verification'),
    { onError: () => {} },
  );

  if (!active || dismissed || !data || data.verified) return null;

  async function resend() {
    setSending(true);
    try {
      await apiFetch('/api/account/email-verification', { method: 'POST' });
      setSent(true);
      toast.success('Verification email sent');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not send the verification email.'));
    } finally {
      setSending(false);
    }
  }

  return (
    <aside
      aria-label="Email verification"
      className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-3 text-sm text-amber-900 dark:text-amber-200">
        <Mail className="w-4 h-4 shrink-0" aria-hidden />
        <p className="flex-1 min-w-0">
          Please confirm your email address — we sent a link to{' '}
          <strong className="font-semibold break-all">{data.email}</strong>.
        </p>
        <button
          type="button"
          onClick={resend}
          disabled={sending || sent}
          className="shrink-0 inline-flex items-center gap-1.5 font-semibold underline underline-offset-2 hover:no-underline disabled:no-underline disabled:opacity-70"
        >
          {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
          {sent ? 'Email sent' : 'Resend email'}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss email verification reminder"
          className="shrink-0 p-1 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/60 transition-colors"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>
    </aside>
  );
}
