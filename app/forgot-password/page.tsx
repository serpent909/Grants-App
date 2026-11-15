'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, MailCheck } from 'lucide-react';
import { AuthShell, AuthField, AuthError, AuthSubmit } from '@/components/auth-shell';
import { apiFetch, json, errorMessage, ApiRequestError } from '@/lib/fetcher';
import { LINK_CLASS } from '@/lib/grant-ui';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiFetch('/api/auth/forgot-password', json('POST', { email }));
      setSentTo(email.trim());
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 400
          ? 'Please enter a valid email address.'
          : errorMessage(err),
      );
    } finally {
      setLoading(false);
    }
  }

  const footer = (
    <>
      Remembered it?{' '}
      <Link href="/login" className={LINK_CLASS}>Back to sign in</Link>
    </>
  );

  if (sentTo) {
    return (
      <AuthShell title="Check your inbox" subtitle="Password reset" footer={footer}>
        <div role="status" className="text-center py-2">
          <MailCheck className="w-8 h-8 mx-auto mb-3 text-teal-600 dark:text-teal-400" aria-hidden />
          <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-2">
            If there is a GrantSearch account for{' '}
            <strong className="font-semibold break-all">{sentTo}</strong>, we have emailed a link to reset
            the password.
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            The link is valid for 1 hour. If nothing arrives in a few minutes, check your spam folder.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your email and we’ll send you a link to choose a new one"
      footer={footer}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoFocus
          maxLength={320}
          placeholder="you@example.com"
        />
        <AuthError message={error} />
        <AuthSubmit loading={loading} icon={Mail}>Send reset link</AuthSubmit>
      </form>
    </AuthShell>
  );
}
