'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Star, Trash2, ExternalLink, CalendarDays, Building2, Search,
  ChevronDown, ClipboardList, CheckCircle2, Loader2, Microscope,
} from 'lucide-react';
import { useShortlistedBySearch, removeFromShortlist, ShortlistedGrant } from '@/lib/shortlist-storage';
import { useDeepSearchMap } from '@/lib/deep-search-storage';
import { startApplication, useApplicationIds } from '@/lib/application-storage';
import { DeepSearchResult } from '@/lib/types';
import { formatAmountRange, formatDeadline, getDeadlineStatus, deadlineStatusLabel } from '@/lib/formatting';
import { typeConfig, LINK_CLASS, PRIMARY_BUTTON_CLASS } from '@/lib/grant-ui';
import { errorMessage } from '@/lib/fetcher';
import { PageShell, PageHeader, EmptyState, ListSkeleton, ErrorState } from '@/components/page-shell';
import { ScoreBadge, SubScores } from '@/components/grant/score';
import DeepSearchDetails, { DetailSection, safeHref } from '@/components/grant/deep-search-details';
import DeadlineBadge from '@/components/grant/deadline-badge';
import ConfirmDialog from '@/components/confirm-dialog';
import { toast } from '@/components/toast';

// ─── Grant card ──────────────────────────────────────────────────────────────

function GrantCard({
  item,
  deep,
  applying,
  onRemove,
  onStartApplication,
}: {
  item: ShortlistedGrant;
  deep: DeepSearchResult | null;
  applying: boolean;
  onRemove: () => void;
  onStartApplication: (item: ShortlistedGrant) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [starting, setStarting] = useState(false);
  const { grant } = item;
  const cfg = typeConfig(grant.type);
  const panelId = `shortlist-${grant.id}`;

  // Use deep search data if available, fall back to grant data
  const amount = formatAmountRange(deep?.amountMin ?? grant.amountMin, deep?.amountMax ?? grant.amountMax);
  const rawDeadline = deep?.applicationCloseDate ?? grant.deadline;
  const deadline = formatDeadline(rawDeadline);
  const scores = deep?.scores ?? grant.scores;
  const grantHref = safeHref(grant.url);

  async function handleStart() {
    setStarting(true);
    try {
      await onStartApplication(item);
    } finally {
      setStarting(false);
    }
  }

  return (
    <li className={`bg-white dark:bg-zinc-800 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-sm overflow-hidden border-l-4 ${cfg.border}`}>
      {/* Collapsed header — always visible */}
      <button
        type="button"
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-zinc-50/70 dark:hover:bg-zinc-700/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm leading-snug">{grant.name}</h3>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ring-1 ${cfg.badge}`}>
              {grant.type}
            </span>
            {applying && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-teal-50 text-teal-700 ring-1 ring-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:ring-teal-800">
                <ClipboardList className="w-3 h-3" aria-hidden />
                Applying
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap text-xs text-zinc-500 dark:text-zinc-400">
            <span className="flex items-center gap-1">
              <Building2 className="w-3 h-3" aria-hidden />
              {grant.funder}
            </span>
            {amount && (
              <span>
                <span className="text-zinc-400 dark:text-zinc-500">Amount:</span>{' '}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{amount}</span>
              </span>
            )}
            {deadline ? (
              <span className="flex items-center gap-1">
                <CalendarDays className="w-3 h-3" aria-hidden />
                <span className="text-zinc-400 dark:text-zinc-500">Closes:</span>{' '}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{deadline}</span>
                <DeadlineBadge
                  status={getDeadlineStatus(rawDeadline)}
                  label={deadlineStatusLabel(rawDeadline, grant.isRecurring, grant.roundFrequency)}
                />
              </span>
            ) : (
              <span className="text-zinc-400 dark:text-zinc-500">Open / Rolling</span>
            )}
          </div>
        </div>

        <SubScores scores={scores} className="hidden sm:flex" />
        <ScoreBadge score={scores?.overall} verified={!!deep} />
        <ChevronDown
          className={`w-4 h-4 text-zinc-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {/* Expanded detail — deep research data */}
      {expanded && (
        <div id={panelId} className="border-t border-zinc-100 dark:border-zinc-700 px-5 py-5 bg-zinc-50/60 dark:bg-zinc-900/30">
          {deep ? (
            <>
              <DeepSearchDetails deep={deep} grant={grant} />
              <Link
                href={`/grant/${encodeURIComponent(grant.id)}/deep-search`}
                className={`inline-flex items-center gap-1.5 mt-4 text-xs ${LINK_CLASS}`}
              >
                <Microscope className="w-3 h-3" aria-hidden />
                Open full research report
              </Link>
            </>
          ) : (
            <>
              {grant.alignmentReason && (
                <DetailSection title="Why It Fits" icon={Star}>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{grant.alignmentReason}</p>
                </DetailSection>
              )}
              <p className="flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400 mt-4">
                <Microscope className="w-3.5 h-3.5 mt-0.5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
                Run a Deep Search on this grant from its funding search to see eligibility criteria,
                key dates and an application checklist here.
              </p>
            </>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 flex-wrap mt-5 pt-4 border-t border-zinc-200 dark:border-zinc-700">
            {!applying ? (
              <button
                type="button"
                onClick={handleStart}
                disabled={starting}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg ${PRIMARY_BUTTON_CLASS}`}
              >
                {starting
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                  : <ClipboardList className="w-3.5 h-3.5" aria-hidden />}
                Start Application
              </button>
            ) : (
              <Link
                href="/applications"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800 dark:hover:bg-emerald-900 transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
                View Application
              </Link>
            )}
            {grantHref && (
              <a
                href={grantHref}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 text-xs ${LINK_CLASS}`}
              >
                View grant page
                <ExternalLink className="w-3 h-3" aria-hidden />
              </a>
            )}
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 transition-colors ml-auto"
            >
              <Trash2 className="w-3 h-3" aria-hidden />
              Remove
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ShortlistedPage() {
  const { data: grouped = {}, isLoading, error, mutate } = useShortlistedBySearch();
  const { data: deepSearchMap } = useDeepSearchMap();
  const { data: applicationIds } = useApplicationIds();

  const totalGrants = Object.values(grouped).reduce((sum, items) => sum + items.length, 0);
  const searchCount = Object.keys(grouped).length;

  // Local optimistic state for newly-started applications
  const [startedIds, setStartedIds] = useState<Set<string>>(new Set());
  const applyingIds = useMemo(() => {
    const merged = new Set(applicationIds ?? []);
    for (const id of startedIds) merged.add(id);
    return merged;
  }, [applicationIds, startedIds]);

  const [removeConfirm, setRemoveConfirm] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState(false);

  async function confirmRemove() {
    if (!removeConfirm) return;
    setRemoving(true);
    try {
      await removeFromShortlist(removeConfirm.id);
      toast.success('Removed from shortlist');
      setRemoveConfirm(null);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not remove this grant.'));
    } finally {
      setRemoving(false);
    }
  }

  async function handleStartApplication(item: ShortlistedGrant) {
    try {
      await startApplication(item);
      setStartedIds(prev => new Set(prev).add(item.grant.id));
      toast.success('Application started — track it under Applications');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not start the application.'));
    }
  }

  return (
    <PageShell>
      <PageHeader
        icon={Star}
        iconClass="bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400"
        title="Shortlisted Grants"
        subtitle={
          isLoading ? 'Loading…'
            : totalGrants === 0 ? 'No grants shortlisted yet'
            : `${totalGrants} grant${totalGrants === 1 ? '' : 's'} across ${searchCount} search${searchCount === 1 ? '' : 'es'}`
        }
      />

      {isLoading ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
      ) : totalGrants === 0 ? (
        <EmptyState
          icon={Star}
          title="No grants shortlisted yet"
          action={
            <Link
              href="/saved"
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <Search className="w-3.5 h-3.5" aria-hidden />
              Go to searches
            </Link>
          }
        >
          Open a funding search and choose <strong>Shortlist</strong> on any grant to keep it here.
        </EmptyState>
      ) : (
        <div className="space-y-10">
          {Object.entries(grouped).map(([searchTitle, items]) => (
            <section key={searchTitle} aria-label={searchTitle}>
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-200">{searchTitle}</h2>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                  {items.length} grant{items.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="space-y-3">
                {items.map(item => (
                  <GrantCard
                    key={item.grant.id}
                    item={item}
                    deep={deepSearchMap?.get(item.grant.id) ?? null}
                    applying={applyingIds.has(item.grant.id)}
                    onRemove={() => setRemoveConfirm({ id: item.grant.id, name: item.grant.name })}
                    onStartApplication={handleStartApplication}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!removeConfirm}
        title="Remove from shortlist?"
        confirmLabel="Remove"
        tone="danger"
        busy={removing}
        onConfirm={confirmRemove}
        onCancel={() => setRemoveConfirm(null)}
      >
        {removeConfirm && (
          <p>
            <span className="font-medium text-zinc-800 dark:text-zinc-200">&ldquo;{removeConfirm.name}&rdquo;</span>{' '}
            will be removed from your shortlist. Any application you&apos;ve started for it is kept.
          </p>
        )}
      </ConfirmDialog>
    </PageShell>
  );
}
