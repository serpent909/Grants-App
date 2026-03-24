'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Loader2, UserPlus, Trash2, Copy, Check } from 'lucide-react';

interface Member {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

interface Invitation {
  id: string;
  email: string;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  invitedByName: string;
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const [orgName, setOrgName] = useState('');
  const [orgNameSaved, setOrgNameSaved] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [orgRes, membersRes, invitesRes] = await Promise.all([
        fetch('/api/org'),
        fetch('/api/org/members'),
        fetch('/api/org/invitations'),
      ]);
      if (orgRes.ok) {
        const org = await orgRes.json();
        setOrgName(org.name);
      }
      if (membersRes.ok) setMembers(await membersRes.json());
      if (invitesRes.ok) setInvitations(await invitesRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleSaveOrgName() {
    await fetch('/api/org', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: orgName }),
    });
    setOrgNameSaved(true);
    setTimeout(() => setOrgNameSaved(false), 2000);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError('');
    setInviteLoading(true);
    try {
      const res = await fetch('/api/org/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail }),
      });
      if (!res.ok) {
        const data = await res.json();
        setInviteError(data.error || 'Failed to send invitation');
      } else {
        setInviteEmail('');
        loadData();
      }
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!confirm('Remove this member from the organisation?')) return;
    await fetch(`/api/org/members?userId=${userId}`, { method: 'DELETE' });
    loadData();
  }

  async function handleRevokeInvite(id: string) {
    await fetch(`/api/org/invitations?id=${id}`, { method: 'DELETE' });
    loadData();
  }

  function copyInviteLink(token: string) {
    const url = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  const user = session?.user as Record<string, unknown> | undefined;
  const currentUserId = user?.id as string;
  const pendingInvites = invitations.filter(i => !i.acceptedAt && new Date(i.expiresAt) > new Date());

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <h1 className="text-xl font-bold text-zinc-900">Settings</h1>

      {/* Organisation Name */}
      <section className="bg-white rounded-xl ring-1 ring-zinc-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900">Organisation</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={orgName}
            onChange={e => setOrgName(e.target.value)}
            className="flex-1 text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
          <button
            onClick={handleSaveOrgName}
            className="px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors"
          >
            {orgNameSaved ? 'Saved' : 'Save'}
          </button>
        </div>
      </section>

      {/* Members */}
      <section className="bg-white rounded-xl ring-1 ring-zinc-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900">Members</h2>
        <div className="divide-y divide-zinc-100">
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between py-2.5">
              <div>
                <p className="text-sm font-medium text-zinc-900">{m.name}</p>
                <p className="text-xs text-zinc-500">{m.email}</p>
              </div>
              {m.id !== currentUserId && (
                <button
                  onClick={() => handleRemoveMember(m.id)}
                  className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                  title="Remove member"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Invite */}
      <section className="bg-white rounded-xl ring-1 ring-zinc-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900">Invite a team member</h2>
        <form onSubmit={handleInvite} className="flex gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            required
            placeholder="colleague@example.com"
            className="flex-1 text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={inviteLoading}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {inviteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Invite
          </button>
        </form>
        {inviteError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{inviteError}</p>
        )}

        {pendingInvites.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Pending invitations</p>
            {pendingInvites.map(inv => (
              <div key={inv.id} className="flex items-center justify-between py-2 px-3 bg-zinc-50 rounded-lg">
                <div>
                  <p className="text-sm text-zinc-700">{inv.email}</p>
                  <p className="text-xs text-zinc-400">
                    Expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => copyInviteLink(inv.token)}
                    className="p-1.5 text-zinc-400 hover:text-teal-600 transition-colors"
                    title="Copy invite link"
                  >
                    {copiedToken === inv.token ? <Check className="w-4 h-4 text-teal-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleRevokeInvite(inv.id)}
                    className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                    title="Revoke invitation"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
