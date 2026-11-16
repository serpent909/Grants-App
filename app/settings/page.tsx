'use client';

import { useState, useId } from 'react';
import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import { Loader2, UserPlus, Trash2, Copy, Check, Settings, KeyRound, Building2, Users, UserRound } from 'lucide-react';
import { apiFetch, json, errorMessage } from '@/lib/fetcher';
import { INPUT_CLASS } from '@/lib/grant-ui';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { PageShell, PageHeader, ListSkeleton, ErrorState } from '@/components/page-shell';
import ConfirmDialog from '@/components/confirm-dialog';
import { toast } from '@/components/toast';

interface Org {
  id: string;
  name: string;
}

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

const SWR_OPTS = { revalidateOnFocus: false } as const;

function useMembers() {
  return useSWR<Member[]>('org:members', () => apiFetch<Member[]>('/api/org/members'), SWR_OPTS);
}

function Card({ icon: Icon, title, description, children }: {
  icon: React.ElementType;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-sm p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-950 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          {description && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

const BUTTON_CLASS =
  'inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50';

// ─── Organisation name ──────────────────────────────────────────────────────

function OrganisationCard({ org, onSaved }: { org: Org; onSaved: () => void }) {
  const { update } = useSession();
  const [name, setName] = useState(org.name);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const dirty = name.trim() !== org.name && name.trim() !== '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    try {
      await apiFetch('/api/org', json('PUT', { name }));
      toast.success('Organisation name updated');
      onSaved();
      void update(); // refresh the name shown in the account menu
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the organisation name.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card icon={Building2} title="Organisation" description="Shown to everyone in your team.">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <label htmlFor={inputId} className="sr-only">Organisation name</label>
        <input
          id={inputId}
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={200}
          required
          className={INPUT_CLASS}
        />
        <button type="submit" disabled={!dirty || saving} className={BUTTON_CLASS}>
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
          Save
        </button>
      </form>
    </Card>
  );
}

// ─── Your profile ───────────────────────────────────────────────────────────

function ProfileCard({ onSaved }: { onSaved: () => void }) {
  const { data: session, update } = useSession();
  const currentName = session?.user?.name ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const name = draft ?? currentName;
  const dirty = name.trim() !== '' && name.trim() !== currentName;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    try {
      await apiFetch('/api/account', json('PUT', { name }));
      await update(); // refresh the name in the session and the account menu
      setDraft(null);
      toast.success('Your name was updated');
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update your name.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card icon={UserRound} title="Your profile" description={session?.user?.email ?? undefined}>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <label htmlFor={inputId} className="sr-only">Your name</label>
        <input
          id={inputId}
          type="text"
          autoComplete="name"
          value={name}
          onChange={e => setDraft(e.target.value)}
          maxLength={200}
          required
          className={INPUT_CLASS}
        />
        <button type="submit" disabled={!dirty || saving} className={BUTTON_CLASS}>
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
          Save
        </button>
      </form>
    </Card>
  );
}

// ─── Password ───────────────────────────────────────────────────────────────

function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const ids = { current: useId(), next: useId(), confirm: useId() };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('Your new password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/account/password', json('PUT', { currentPassword, newPassword }));
      toast.success('Password changed');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(errorMessage(err, 'Could not change your password.'));
    } finally {
      setSaving(false);
    }
  }

  const labelClass = 'text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5';

  return (
    <Card icon={KeyRound} title="Password" description="Use at least 8 characters.">
      <form onSubmit={handleSubmit} className="space-y-3 max-w-sm">
        <div>
          <label htmlFor={ids.current} className={labelClass}>Current password</label>
          <input
            id={ids.current}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            required
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor={ids.next} className={labelClass}>New password</label>
          <input
            id={ids.next}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            required
            minLength={8}
            maxLength={200}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor={ids.confirm} className={labelClass}>Confirm new password</label>
          <input
            id={ids.confirm}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            maxLength={200}
            className={INPUT_CLASS}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950 rounded-lg px-3 py-2">{error}</p>
        )}
        <button type="submit" disabled={saving} className={BUTTON_CLASS}>
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
          Change password
        </button>
      </form>
    </Card>
  );
}

// ─── Team ───────────────────────────────────────────────────────────────────

function TeamCard({ currentUserId, members }: {
  currentUserId?: string;
  members: ReturnType<typeof useMembers>;
}) {
  const invitations = useSWR<Invitation[]>('org:invitations', () => apiFetch<Invitation[]>('/api/org/invitations'), SWR_OPTS);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [invite, setInvite] = useState<{ email: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [removing, setRemoving] = useState(false);
  const emailId = useId();

  const pendingInvites = (invitations.data ?? []).filter(
    i => !i.acceptedAt && new Date(i.expiresAt) > new Date(),
  );

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError('');
    setInvite(null);
    setInviteLoading(true);
    try {
      const data = await apiFetch<{ token: string }>('/api/org/invitations', json('POST', { email: inviteEmail }));
      setInvite({ email: inviteEmail, link: `${window.location.origin}/invite/${data.token}` });
      setInviteEmail('');
      void invitations.mutate();
    } catch (err) {
      setInviteError(errorMessage(err, 'Could not create the invitation.'));
    } finally {
      setInviteLoading(false);
    }
  }

  async function copyInviteLink() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select the link and copy it manually.');
    }
  }

  async function confirmRemoveMember() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await apiFetch(`/api/org/members?userId=${encodeURIComponent(removeTarget.id)}`, { method: 'DELETE' });
      toast.success(`${removeTarget.name || removeTarget.email} removed`);
      setRemoveTarget(null);
      void members.mutate();
      void invitations.mutate();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not remove this member.'));
    } finally {
      setRemoving(false);
    }
  }

  async function handleRevokeInvite(id: string) {
    try {
      await apiFetch(`/api/org/invitations?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast.success('Invitation revoked');
      void invitations.mutate();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not revoke the invitation.'));
    }
  }

  return (
    <Card
      icon={Users}
      title="Team"
      description="Everyone here shares your searches, shortlist, applications and documents."
    >
      {/* Members */}
      {members.isLoading ? (
        <div className="py-3" role="status" aria-label="Loading members">
          <Loader2 className="w-4 h-4 animate-spin text-zinc-400" aria-hidden />
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-700">
          {(members.data ?? []).map(m => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {m.name}
                  {m.id === currentUserId && (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950 px-1.5 py-0.5 rounded">You</span>
                  )}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{m.email}</p>
              </div>
              {m.id !== currentUserId && (
                <Tooltip>
                  <TooltipTrigger
                    onClick={() => setRemoveTarget(m)}
                    aria-label={`Remove ${m.name || m.email}`}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent>Remove member</TooltipContent>
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Invite */}
      <div className="mt-5 pt-5 border-t border-zinc-100 dark:border-zinc-700 space-y-3">
        <label htmlFor={emailId} className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block">
          Invite a team member
        </label>
        <form onSubmit={handleInvite} className="flex gap-2">
          <input
            id={emailId}
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            required
            placeholder="colleague@example.com"
            className={INPUT_CLASS}
          />
          <button type="submit" disabled={inviteLoading} className={BUTTON_CLASS}>
            {inviteLoading
              ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              : <UserPlus className="w-4 h-4" aria-hidden />}
            Invite
          </button>
        </form>

        {inviteError && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950 rounded-lg px-3 py-2">{inviteError}</p>
        )}

        {invite && (
          <div role="status" className="bg-emerald-50 dark:bg-emerald-950 rounded-lg px-3 py-3 space-y-2">
            <p className="text-sm text-emerald-800 dark:text-emerald-300">
              Invitation created for <strong>{invite.email}</strong>. Send them this link — it is valid for 48 hours and can only be used once.
            </p>
            <div className="flex items-center gap-2">
              <code className="text-xs text-emerald-700 dark:text-emerald-400 font-mono truncate flex-1 bg-white/60 dark:bg-black/20 rounded px-2 py-1.5">
                {invite.link}
              </code>
              <button
                type="button"
                onClick={copyInviteLink}
                className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5" aria-hidden /> : <Copy className="w-3.5 h-3.5" aria-hidden />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-emerald-700 dark:text-emerald-500">
              Copy it now — for security the link is not stored and won&apos;t be shown again.
            </p>
          </div>
        )}

        {pendingInvites.length > 0 && (
          <div className="pt-1 space-y-2">
            <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Pending invitations</h3>
            <ul className="space-y-2">
              {pendingInvites.map(inv => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2 px-3 bg-zinc-50 dark:bg-zinc-900 rounded-lg">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{inv.email}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-500">
                      Expires {new Date(inv.expiresAt).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger
                      onClick={() => handleRevokeInvite(inv.id)}
                      aria-label={`Revoke invitation for ${inv.email}`}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden />
                    </TooltipTrigger>
                    <TooltipContent>Revoke invitation</TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove team member?"
        confirmLabel="Remove member"
        tone="danger"
        busy={removing}
        onConfirm={confirmRemoveMember}
        onCancel={() => setRemoveTarget(null)}
      >
        {removeTarget && (
          <p>
            <span className="font-medium text-zinc-800 dark:text-zinc-200">{removeTarget.name || removeTarget.email}</span>{' '}
            will lose access to this organisation within a few minutes, and any invitations they sent will be revoked.
            Their account will be deleted.
          </p>
        )}
      </ConfirmDialog>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data: session } = useSession();
  const org = useSWR<Org>('org', () => apiFetch<Org>('/api/org'), SWR_OPTS);
  const members = useMembers();

  return (
    <PageShell width="max-w-3xl">
      <PageHeader icon={Settings} title="Settings" subtitle="Your organisation, team and account" />

      {org.isLoading ? (
        <ListSkeleton rows={3} />
      ) : org.error || !org.data ? (
        <ErrorState message={errorMessage(org.error)} onRetry={() => org.mutate()} />
      ) : (
        <div className="space-y-5">
          <ProfileCard onSaved={() => members.mutate()} />
          <OrganisationCard key={org.data.name} org={org.data} onSaved={() => org.mutate()} />
          <TeamCard currentUserId={session?.user?.id} members={members} />
          <PasswordCard />
        </div>
      )}
    </PageShell>
  );
}
