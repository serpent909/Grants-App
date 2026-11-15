'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { Loader2, KeyRound, MailX, CircleCheck } from 'lucide-react';
import { AuthShell, PasswordField, AuthError, AuthSubmit } from '@/components/auth-shell';
import { apiFetch, json, errorMessage, ApiRequestError } from '@/lib/fetcher';
import { LINK_CLASS } from '@/lib/grant-ui';

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();

  // Check the link up front so an expired one says so before a password is typed.
  // Failure is rendered below, so the global error toast is switched off here.
  const check = useSWR(
    ['reset-password', token],
    () => apiFetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`),
    { revalidateOnFocus: false, revalidateOnReconnect: false, onError: () => {} },
  );

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Your new password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await apiFetch('/api/auth/reset-password', json('POST', { token, password }));
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, 'Could not reset your password.'));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthShell title="Password updated" subtitle="You can now sign in with your new password">
        <div role="status" className="text-center py-2">
          <CircleCheck className="w-8 h-8 mx-auto mb-3 text-teal-600 dark:text-teal-400" aria-hidden />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            For your security, any devices that were signed in to your account will be signed out
            within a few minutes.
          </p>
          <Link href="/login" className={`text-sm ${LINK_CLASS}`}>Go to sign in</Link>
        </div>
      </AuthShell>
    );
  }

  if (check.isLoading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-canvas flex items-center justify-center" role="status" aria-label="Checking reset link">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" aria-hidden />
      </div>
    );
  }

  if (check.error) {
    // Only a 400/410 means the link itself is bad. Anything else (rate limit,
    // network, server error) says nothing about the link, so offer a retry
    // rather than telling the user to request a new one.
    const status = check.error instanceof ApiRequestError ? check.error.status : 0;
    const linkIsBad = status === 400 || status === 410;
    return (
      <AuthShell
        title={linkIsBad ? 'Reset link unavailable' : 'We couldn’t check this link'}
        subtitle={linkIsBad ? 'This link can’t be used to reset a password' : 'Your reset link may still be fine'}
      >
        <div className="text-center py-2">
          <MailX className="w-8 h-8 mx-auto mb-3 text-zinc-300 dark:text-zinc-600" aria-hidden />
          <p role="alert" className="text-sm text-zinc-700 dark:text-zinc-300 mb-4">
            {errorMessage(check.error)}
          </p>
          {linkIsBad ? (
            <Link href="/forgot-password" className={`text-sm ${LINK_CLASS}`}>Request a new link</Link>
          ) : (
            <button type="button" onClick={() => check.mutate()} className={`text-sm ${LINK_CLASS}`}>
              Try again
            </button>
          )}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="This will sign you out on your other devices"
      footer={<Link href="/login" className={LINK_CLASS}>Back to sign in</Link>}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <PasswordField
          label="New password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          autoFocus
          minLength={8}
          maxLength={200}
          placeholder="At least 8 characters"
          hint="Use 8 or more characters. A short phrase is stronger than a single word."
        />
        <PasswordField
          label="Confirm new password"
          name="confirm-password"
          autoComplete="new-password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          required
          minLength={8}
          maxLength={200}
          placeholder="Type it again"
        />
        <AuthError message={error} />
        <AuthSubmit loading={loading} icon={KeyRound}>Reset password</AuthSubmit>
      </form>
    </AuthShell>
  );
}
