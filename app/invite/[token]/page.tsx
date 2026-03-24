'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Loader2, UserPlus } from 'lucide-react';
import Link from 'next/link';

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
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
    async function validate() {
      try {
        const res = await fetch(`/api/auth/invite?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          const data = await res.json();
          setInvalid(data.error || 'Invalid invitation');
        } else {
          const data = await res.json();
          setOrgName(data.orgName);
          setEmail(data.email);
        }
      } catch {
        setInvalid('Failed to validate invitation');
      } finally {
        setValidating(false);
      }
    }
    validate();
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
        const data = await res.json();
        setError(data.error || 'Failed to accept invitation');
        setLoading(false);
        return;
      }

      // Auto sign-in
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Account created but sign-in failed. Try logging in.');
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
      <div className="min-h-screen bg-[#f7f5f0] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="min-h-screen bg-[#f7f5f0] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold text-zinc-900 mb-2">GrantSearch</h1>
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-zinc-200 p-6">
            <p className="text-sm text-red-600 mb-4">{invalid}</p>
            <Link href="/login" className="text-sm font-medium text-teal-600 hover:text-teal-700">
              Go to login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f5f0] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-zinc-900">GrantSearch</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Join <span className="font-medium text-zinc-700">{orgName}</span>
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm ring-1 ring-zinc-200 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-zinc-600 block mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                disabled
                className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 bg-zinc-50 text-zinc-500"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-zinc-600 block mb-1.5">Your name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
                className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                placeholder="Jane Smith"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-zinc-600 block mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                placeholder="At least 8 characters"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Join {orgName}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
