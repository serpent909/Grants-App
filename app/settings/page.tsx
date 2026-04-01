'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Loader2, UserPlus, Trash2, Copy, Check } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface Member {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

interface Invitation {
  id: string;
  email: string;
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
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
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
    setInviteSuccess('');
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
        const data = await res.json();
        setInviteEmail('');
        setInviteSuccess(`Invitation created for ${inviteEmail}`);
        setInviteLink(`${window.location.origin}/invite/${data.token}`);
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

  function copyInviteLink() {
    navigator.clipboard.writeText(inviteLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
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
    <div className="min-h-screen max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Settings</h1>

      {/* Organisation Name */}
      <section className="bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Organisation</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={orgName}
            onChange={e => setOrgName(e.target.value)}
            className="flex-1 text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
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
      <section className="bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Members</h2>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between py-2.5">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{m.name}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{m.email}</p>
              </div>
              {m.id !== currentUserId && (
                <Tooltip>
                  <TooltipTrigger
                    onClick={() => handleRemoveMember(m.id)}
                    className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </TooltipTrigger>
                  <TooltipContent>Remove member</TooltipContent>
                </Tooltip>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Invite */}
      <section className="bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Invite a team member</h2>
        <form onSubmit={handleInvite} className="flex gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            required
            placeholder="colleague@example.com"
            className="flex-1 text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
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
          <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950 rounded-lg px-3 py-2">{inviteError}</p>
        )}
        {inviteSuccess && inviteLink && (
          <div className="bg-emerald-50 dark:bg-emerald-950 rounded-lg px-3 py-2 space-y-2">
            <p className="text-sm text-emerald-700 dark:text-emerald-400">{inviteSuccess}</p>
            <div className="flex items-center gap-2">
              <p className="text-xs text-emerald-600 dark:text-emerald-500 font-mono truncate flex-1">{inviteLink}</p>
              <button
                onClick={copyInviteLink}
                className="flex-shrink-0 p-1.5 text-emerald-600 hover:text-emerald-700 transition-colors"
              >
                {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-emerald-600 dark:text-emerald-500">Copy this link now — it won&apos;t be shown again.</p>
          </div>
        )}

        {pendingInvites.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Pending invitations</p>
            {pendingInvites.map(inv => (
              <div key={inv.id} className="flex items-center justify-between py-2 px-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
                <div>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">{inv.email}</p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    Expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <Tooltip>
                  <TooltipTrigger
                    onClick={() => handleRevokeInvite(inv.id)}
                    className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </TooltipTrigger>
                  <TooltipContent>Revoke invitation</TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
