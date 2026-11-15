'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { UserPlus } from 'lucide-react';
import Link from 'next/link';
import { AuthShell, AuthField, PasswordField, AuthError, AuthSubmit } from '@/components/auth-shell';
import { LINK_CLASS } from '@/lib/grant-ui';

export default function SignupPage() {
  const [orgName, setOrgName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Create org + user
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, orgName }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          res.status === 429
            ? 'Too many sign-up attempts. Please try again later.'
            : res.status === 400
              ? 'Please check your details — a valid email and a password of at least 8 characters are required.'
              : data.error || 'Sign-up failed. Please try again.',
        );
        setLoading(false);
        return;
      }

      // Auto sign-in
      const result = await signIn('credentials', { email, password, redirect: false });

      if (result?.error) {
        // The API answers identically whether or not the email was already
        // registered, so this is the only hint we can give.
        setError('We couldn’t sign you in automatically. If you already have an account with this email, sign in instead.');
        setLoading(false);
      } else {
        window.location.href = '/';
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Set up your organisation and start finding grants"
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className={LINK_CLASS}>Sign in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label="Organisation name"
          type="text"
          name="organization"
          autoComplete="organization"
          value={orgName}
          onChange={e => setOrgName(e.target.value)}
          required
          autoFocus
          maxLength={200}
          placeholder="e.g. Helping Hands Trust"
        />
        <AuthField
          label="Your name"
          type="text"
          name="name"
          autoComplete="name"
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={200}
          placeholder="Jane Smith"
        />
        <AuthField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          placeholder="you@example.com"
        />
        <PasswordField
          label="Password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          minLength={8}
          maxLength={200}
          placeholder="At least 8 characters"
          hint="Use 8 or more characters. A short phrase is stronger than a single word."
        />
        <AuthError message={error} />
        <AuthSubmit loading={loading} icon={UserPlus}>Create account</AuthSubmit>
      </form>
    </AuthShell>
  );
}
