'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Loader2, UserPlus, MailX } from 'lucide-react';
import Link from 'next/link';
import { AuthShell, AuthField, PasswordField, AuthError, AuthSubmit } from '@/components/auth-shell';
import { LINK_CLASS } from '@/lib/grant-ui';

export default function InvitePage() {
  const params = useParams();
  const token = params.token as string;

  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [invalid, setInvalid] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function validate() {
      try {
        const res = await fetch(`/api/auth/invite?token=${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setInvalid(data.error || 'Invalid invitation');
        } else {
          setOrgName(data.orgName);
          setEmail(data.email);
        }
      } catch {
        if (!cancelled) setInvalid('We couldn’t check this invitation. Please try again.');
      } finally {
        if (!cancelled) setValidating(false);
      }
    }
    validate();
    return () => { cancelled = true; };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to accept invitation');
        setLoading(false);
        return;
      }

      // Auto sign-in
      const result = await signIn('credentials', { email, password, redirect: false });

      if (result?.error) {
        setError('Your account was created, but we couldn’t sign you in automatically. Please sign in.');
        setLoading(false);
      } else {
        window.location.href = '/';
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  if (validating) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-canvas flex items-center justify-center" role="status" aria-label="Checking invitation">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" aria-hidden />
      </div>
    );
  }

  if (invalid) {
    return (
      <AuthShell title="Invitation unavailable" subtitle="This link can’t be used to join an organisation">
        <div className="text-center py-2">
          <MailX className="w-8 h-8 mx-auto mb-3 text-zinc-300 dark:text-zinc-600" aria-hidden />
          <p role="alert" className="text-sm text-zinc-700 dark:text-zinc-300 mb-1">{invalid}</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            Ask the person who invited you to send a new link.
          </p>
          <Link href="/login" className={`text-sm ${LINK_CLASS}`}>Go to sign in</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Join ${orgName}`}
      subtitle="You’ve been invited to collaborate on GrantSearch"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField label="Email" type="email" value={email} disabled readOnly autoComplete="username" />
        <AuthField
          label="Your name"
          type="text"
          name="name"
          autoComplete="name"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          maxLength={200}
          placeholder="Jane Smith"
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
        />
        <AuthError message={error} />
        <AuthSubmit loading={loading} icon={UserPlus}>Join {orgName}</AuthSubmit>
      </form>
    </AuthShell>
  );
}
