'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  Search, History, Star, ClipboardList, Trophy, ArrowRight, AlarmClock,
  Microscope, FileText, Sparkles, CheckCircle2,
} from 'lucide-react';
import { useSavedSearches } from '@/lib/saved-searches';
import { useShortlistedBySearch } from '@/lib/shortlist-storage';
import { useApplicationsByStatus, emptyGrouped } from '@/lib/application-storage';
import { useDeepSearchMap } from '@/lib/deep-search-storage';
import { deadlinesToWatch, describeDays } from '@/lib/deadlines';
import { formatCurrency, formatDate } from '@/lib/formatting';
import { STATUS_CONFIG, STATUS_ORDER, PRIMARY_BUTTON_CLASS, LINK_CLASS } from '@/lib/grant-ui';
import { errorMessage } from '@/lib/fetcher';
import { PageShell, ListSkeleton, ErrorState } from '@/components/page-shell';
import { ScoreBadge } from '@/components/grant/score';

const EMPTY_GROUPED = emptyGrouped();
const CARD = 'bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-sm';

// ─── Building blocks ────────────────────────────────────────────────────────

function StatLink({ href, icon: Icon, label, value, hint }: {
  href: string;
  icon: React.ElementType;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className={`${CARD} group px-4 py-3.5 hover:ring-teal-300 dark:hover:ring-teal-700 hover:shadow-md transition-all`}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        <Icon className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" aria-hidden />
        {label}
      </span>
      <span className="block text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-display tabular-nums mt-1">{value}</span>
      <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{hint}</span>
    </Link>
  );
}

function Panel({ title, icon: Icon, action, children }: {
  title: string;
  icon: React.ElementType;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className={`${CARD} overflow-hidden`} aria-label={title}>
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-700">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <Icon className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
          {title}
        </h2>
        {action && (
          <Link href={action.href} className={`inline-flex items-center gap-1 text-xs ${LINK_CLASS}`}>
            {action.label}
            <ArrowRight className="w-3 h-3" aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** One suggested next step: what to do, why, and where to do it. */
function NextStep({ href, icon: Icon, tone, title, detail }: {
  href: string;
  icon: React.ElementType;
  tone: 'amber' | 'teal' | 'red';
  title: string;
  detail: string;
}) {
  const tones = {
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
    teal: 'bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400',
    red: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
  };
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-5 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-700/40 transition-colors group">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tones[tone]}`}>
          <Icon className="w-4 h-4" aria-hidden />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400 truncate">{detail}</span>
        </span>
        <ArrowRight className="w-4 h-4 text-zinc-300 dark:text-zinc-600 group-hover:text-teal-600 dark:group-hover:text-teal-400 group-hover:translate-x-0.5 transition-all shrink-0" aria-hidden />
      </Link>
    </li>
  );
}

// ─── First-run welcome ──────────────────────────────────────────────────────

function Welcome({ firstName }: { firstName: string }) {
  const steps = [
    { icon: Search, title: 'Describe what you need', text: 'Your organisation, where you work, and what the funding is for.' },
    { icon: Microscope, title: 'Review ranked matches', text: 'Every relevant grant scored for fit, ease and your chance of success.' },
    { icon: ClipboardList, title: 'Shortlist and apply', text: 'Research the best ones in depth and track each application.' },
  ];
  return (
    <div className={`${CARD} px-6 py-10 sm:px-10 text-center`}>
      <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
        {firstName ? `Kia ora, ${firstName}` : 'Kia ora'}
      </h1>
      <p className="text-zinc-500 dark:text-zinc-400 mt-2 max-w-md mx-auto">
        Find the grants most likely to fund your work. Your first search takes about two minutes.
      </p>
      <ol className="grid sm:grid-cols-3 gap-4 mt-8 text-left">
        {steps.map(({ icon: Icon, title, text }, i) => (
          <li key={title} className="rounded-xl bg-zinc-50 dark:bg-zinc-900/50 p-4">
            <span className="flex items-center gap-2 text-xs font-semibold text-teal-700 dark:text-teal-400">
              <Icon className="w-4 h-4" aria-hidden />
              Step {i + 1}
            </span>
            <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-2">{title}</span>
            <span className="block text-sm text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">{text}</span>
          </li>
        ))}
      </ol>
      <Link
        href="/search"
        className={`inline-flex items-center gap-2 mt-8 px-6 h-11 text-sm font-semibold rounded-xl ${PRIMARY_BUTTON_CLASS}`}
      >
        <Search className="w-4 h-4" aria-hidden />
        Start your first search
      </Link>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: session } = useSession();
  const searches = useSavedSearches();
  const shortlist = useShortlistedBySearch();
  const applications = useApplicationsByStatus();
  const { data: deepSearches } = useDeepSearchMap();

  const grouped = applications.data ?? EMPTY_GROUPED;
  const firstName = (session?.user?.name || '').trim().split(/\s+/)[0] ?? '';

  const summary = useMemo(() => {
    const allApps = STATUS_ORDER.flatMap(status => grouped[status]);
    const appliedIds = new Set(allApps.map(a => a.grantId));
    const shortlisted = Object.values(shortlist.data ?? {}).flat();
    const notStarted = shortlisted.filter(item => !appliedIds.has(item.grant.id));
    const inProgress = grouped.preparing.length + grouped.submitted.length + grouped['under-review'].length;
    const awarded = grouped.approved.reduce((sum, a) => sum + (Number(a.amountAwarded) || 0), 0);

    // The best matches in the latest search that have not been researched yet.
    const latest = searches.data?.[0];
    const unresearched = (latest?.result?.grants ?? [])
      .filter(g => !deepSearches?.has(g.id) && (g.scores?.overall ?? 0) >= 7)
      .sort((a, b) => (b.scores?.overall ?? 0) - (a.scores?.overall ?? 0));

    return {
      totalApps: allApps.length,
      shortlistedCount: shortlisted.length,
      notStarted,
      inProgress,
      awarded,
      latest,
      unresearched,
      watch: deadlinesToWatch(grouped.preparing, deepSearches, 4),
    };
  }, [grouped, shortlist.data, searches.data, deepSearches]);

  const loading = searches.isLoading || applications.isLoading || shortlist.isLoading;
  const loadError = searches.error || applications.error || shortlist.error;

  if (loading) {
    return <PageShell><ListSkeleton rows={4} /></PageShell>;
  }
  if (loadError) {
    return (
      <PageShell>
        <ErrorState
          message={errorMessage(loadError)}
          onRetry={() => { void searches.mutate(); void applications.mutate(); void shortlist.mutate(); }}
        />
      </PageShell>
    );
  }

  const searchList = searches.data ?? [];
  const isNew = searchList.length === 0 && summary.totalApps === 0 && summary.shortlistedCount === 0;
  if (isNew) {
    return <PageShell width="max-w-4xl"><Welcome firstName={firstName} /></PageShell>;
  }

  const overdue = summary.watch.filter(w => w.days < 0);
  const upcoming = summary.watch.filter(w => w.days >= 0);
  const hasNextSteps =
    overdue.length > 0 || upcoming.length > 0 || summary.notStarted.length > 0 || summary.unresearched.length > 0;

  return (
    <PageShell>
      <header className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {firstName ? `Kia ora, ${firstName}` : 'Dashboard'}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            {session?.user?.orgName ? `${session.user.orgName} · ` : ''}your funding pipeline at a glance
          </p>
        </div>
        <Link
          href="/search"
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl ${PRIMARY_BUTTON_CLASS}`}
        >
          <Search className="w-3.5 h-3.5" aria-hidden />
          New search
        </Link>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatLink
          href="/saved"
          icon={History}
          label="Searches"
          value={String(searchList.length)}
          hint={summary.latest ? `Latest: ${summary.latest.grantCount} grants` : 'None yet'}
        />
        <StatLink
          href="/shortlisted"
          icon={Star}
          label="Shortlisted"
          value={String(summary.shortlistedCount)}
          hint={summary.notStarted.length > 0 ? `${summary.notStarted.length} not started` : 'All being applied for'}
        />
        <StatLink
          href="/applications"
          icon={ClipboardList}
          label="In progress"
          value={String(summary.inProgress)}
          hint={`${summary.totalApps} application${summary.totalApps === 1 ? '' : 's'} in total`}
        />
        <StatLink
          href="/applications"
          icon={Trophy}
          label="Awarded"
          value={summary.awarded > 0 ? formatCurrency(summary.awarded) : '—'}
          hint={`${grouped.approved.length} approved`}
        />
      </div>

      <div className="grid lg:grid-cols-5 gap-5">
        {/* ── What to do next ── */}
        <div className="lg:col-span-3 space-y-5">
          <Panel title="Next steps" icon={Sparkles}>
            {hasNextSteps ? (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-700">
                {overdue.map(({ app, deadline, days }) => (
                  <NextStep
                    key={`overdue-${app.grantId}`}
                    href="/applications"
                    icon={AlarmClock}
                    tone="red"
                    title={`Deadline passed: ${app.grant.name}`}
                    detail={`${describeDays(days)} (${formatDate(deadline)}) · submit, withdraw or wait for the next round`}
                  />
                ))}
                {upcoming.map(({ app, deadline, days }) => (
                  <NextStep
                    key={`due-${app.grantId}`}
                    href="/applications"
                    icon={AlarmClock}
                    tone="amber"
                    title={`Due ${days <= 1 ? describeDays(days).toLowerCase() : `in ${days} days`}: ${app.grant.name}`}
                    detail={`${app.grant.funder} · closes ${formatDate(deadline)}`}
                  />
                ))}
                {summary.notStarted.length > 0 && (
                  <NextStep
                    href="/shortlisted"
                    icon={Star}
                    tone="amber"
                    title={`Start ${summary.notStarted.length === 1 ? 'an application' : 'applications'} for ${summary.notStarted.length} shortlisted grant${summary.notStarted.length === 1 ? '' : 's'}`}
                    detail={summary.notStarted.slice(0, 3).map(i => i.grant.name).join(' · ')}
                  />
                )}
                {summary.unresearched.length > 0 && summary.latest && (
                  <NextStep
                    href={`/results?saved=${encodeURIComponent(summary.latest.id)}`}
                    icon={Microscope}
                    tone="teal"
                    title={`Research ${summary.unresearched.length} strong match${summary.unresearched.length === 1 ? '' : 'es'} in “${summary.latest.name}”`}
                    detail={summary.unresearched.slice(0, 3).map(g => g.name).join(' · ')}
                  />
                )}
              </ul>
            ) : (
              <p className="flex items-center gap-2 px-5 py-6 text-sm text-zinc-500 dark:text-zinc-400">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden />
                You&apos;re up to date. Run a new search to find more funding.
              </p>
            )}
          </Panel>

          <Panel title="Recent searches" icon={History} action={{ href: '/saved', label: 'All searches' }}>
            {searchList.length > 0 ? (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-700">
                {searchList.slice(0, 4).map(saved => {
                  const best = Math.max(0, ...(saved.result?.grants ?? []).map(g => g.scores?.overall ?? 0));
                  return (
                    <li key={saved.id}>
                      <Link
                        href={`/results?saved=${encodeURIComponent(saved.id)}`}
                        className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-700/40 transition-colors"
                      >
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{saved.name}</span>
                          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                            {saved.grantCount} grant{saved.grantCount === 1 ? '' : 's'} · {formatDate(saved.result?.searchedAt || saved.savedAt)}
                          </span>
                        </span>
                        {best > 0 && (
                          <span className="flex items-center gap-2 shrink-0">
                            <span className="hidden sm:inline text-[11px] text-zinc-500 dark:text-zinc-400">Best match</span>
                            <ScoreBadge score={best} size="sm" />
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-zinc-500 dark:text-zinc-400">
                No searches yet. <Link href="/search" className={LINK_CLASS}>Run your first search</Link>.
              </p>
            )}
          </Panel>
        </div>

        {/* ── Pipeline ── */}
        <div className="lg:col-span-2 space-y-5">
          <Panel title="Applications" icon={ClipboardList} action={{ href: '/applications', label: 'Open' }}>
            {summary.totalApps > 0 ? (
              <ul className="px-5 py-4 space-y-3">
                {STATUS_ORDER.map(status => {
                  const count = grouped[status].length;
                  const cfg = STATUS_CONFIG[status];
                  const Icon = cfg.icon;
                  const share = summary.totalApps > 0 ? (count / summary.totalApps) * 100 : 0;
                  return (
                    <li key={status} className={count === 0 ? 'opacity-50' : ''}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
                          <Icon className="w-3 h-3" aria-hidden />
                          {cfg.label}
                        </span>
                        <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-700 overflow-hidden" aria-hidden>
                        <div className="h-full rounded-full bg-teal-500" style={{ width: `${share}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-zinc-500 dark:text-zinc-400">
                No applications yet. Shortlist a grant, then choose <strong>Start Application</strong>.
              </p>
            )}
          </Panel>

          <Panel title="Documents" icon={FileText} action={{ href: '/documents', label: 'Library' }}>
            <p className="px-5 py-4 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Keep the documents funders ask for most — financial statements, your constitution,
              proof of charitable status — in one place and attach them to any application.
            </p>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
