'use client';

import { useState, useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { LogIn } from 'lucide-react';
import Link from 'next/link';
import {
  AuthShell, AuthField, PasswordField, AuthError, AuthSubmit, postLoginDestination,
} from '@/components/auth-shell';
import { LINK_CLASS } from '@/lib/grant-ui';

export default function LoginPage() {
  const { status } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Already signed in (or just signed in) → continue to where they were heading.
  useEffect(() => {
    if (status === 'authenticated') {
      window.location.href = postLoginDestination();
    }
  }, [status]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        // 429 from the login rate limiter surfaces here too.
        setError(
          result.status === 429
            ? 'Too many attempts. Please wait a minute and try again.'
            : 'Invalid email or password',
        );
        setLoading(false);
      }
      // On success, useSession updates to 'authenticated' and the effect redirects.
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your GrantSearch account"
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link href="/signup" className={LINK_CLASS}>Create one</Link>
        </>
      }
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
          placeholder="you@example.com"
        />
        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          placeholder="Enter your password"
        />
        <AuthError message={error} />
        <AuthSubmit loading={loading} icon={LogIn}>Sign in</AuthSubmit>
      </form>
    </AuthShell>
  );
}
