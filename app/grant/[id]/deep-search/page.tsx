'use client';

import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft, ExternalLink, CheckCircle2, Circle,
  CalendarDays, DollarSign, FileText, Users,
  TrendingUp, TrendingDown, Minus, Link2, ClipboardList,
  ShieldCheck, Info, MessageSquare,
} from 'lucide-react';
import { DeepSearchScoreChange } from '@/lib/types';
import { useDeepSearch } from '@/lib/deep-search-storage';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 8) return '#10b981';
  if (score >= 6.5) return '#f59e0b';
  if (score >= 5) return '#f97316';
  return '#ef4444';
}

function scoreTextClass(score: number): string {
  if (score >= 8) return 'text-emerald-700 bg-emerald-50';
  if (score >= 6.5) return 'text-amber-700 bg-amber-50';
  if (score >= 5) return 'text-orange-600 bg-orange-50';
  return 'text-red-600 bg-red-50';
}

function formatCurrency(n?: number) {
  if (!n) return '';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
}

function formatAmountRange(min?: number, max?: number) {
  if (!min && !max) return null;
  if (min && max) return `${formatCurrency(min)}–${formatCurrency(max)}`;
  if (max) return `Up to ${formatCurrency(max)}`;
  return `From ${formatCurrency(min)}`;
}

function formatDate(d?: string) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return d; }
}

// ─── Score Ring ──────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 64 }: { score: number; size?: number }) {
  const strokeW = 5;
  const r = (size - strokeW * 2) / 2;
  const circ = 2 * Math.PI * r;
  const arc = Math.max(0, Math.min(1, score / 10)) * circ;
  const color = scoreColor(score);

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f4f4f5" strokeWidth={strokeW} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={strokeW}
          strokeDasharray={`${arc} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-bold text-zinc-800 tabular-nums" style={{ fontSize: 14 }}>{score.toFixed(1)}</span>
      </div>
      <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center ring-2 ring-white">
        <CheckCircle2 className="w-3 h-3 text-white" />
      </div>
    </div>
  );
}

// ─── Score Change Row ────────────────────────────────────────────────────────

function ScoreChangeRow({ label, change }: { label: string; change: DeepSearchScoreChange }) {
  const delta = change.new - change.old;
  const deltaColor = delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-500' : 'text-zinc-400';
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;

  return (
    <div className="py-3 border-b border-zinc-100 last:border-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium text-zinc-700">{label}</span>
        <div className="flex items-center gap-2.5">
          <span className="text-sm tabular-nums text-zinc-400">{change.old.toFixed(1)}</span>
          <span className="text-zinc-300">&rarr;</span>
          <span className={`text-sm font-bold tabular-nums px-1.5 py-0.5 rounded-md ${scoreTextClass(change.new)}`}>
            {change.new.toFixed(1)}
          </span>
          <span className={`text-xs font-semibold flex items-center gap-0.5 ${deltaColor}`}>
            <DeltaIcon className="w-3 h-3" />
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}
          </span>
        </div>
      </div>
      <p className="text-xs text-zinc-500 leading-relaxed">{change.reason}</p>
    </div>
  );
}

// ─── Section Card ────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl ring-1 ring-zinc-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-zinc-100 bg-zinc-50/50">
        <Icon className="w-4 h-4 text-teal-600" />
        <h3 className="text-xs font-semibold text-zinc-700 uppercase tracking-wider">{title}</h3>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DeepSearchPage() {
  const params = useParams();
  const router = useRouter();
  const grantId = decodeURIComponent(params.id as string);
  const { data, isLoading } = useDeepSearch(grantId);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="text-center">
          <p className="font-semibold text-zinc-600 mb-2">Deep search not found</p>
          <p className="text-sm text-zinc-400 mb-4">This deep search result may have been cleared from your browser.</p>
          <button
            onClick={() => router.back()}
            className="text-sm font-semibold text-teal-600 hover:text-teal-700"
          >
            &larr; Go back
          </button>
        </div>
      </div>
    );
  }

  const amount = formatAmountRange(data.amountMin, data.amountMax);
  const openDate = formatDate(data.applicationOpenDate);
  const closeDate = formatDate(data.applicationCloseDate);

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200">
        <div className="max-w-3xl mx-auto px-6 py-5">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 transition-colors mb-4 group"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            Back to results
          </button>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-zinc-900 leading-tight">{data.grantName}</h1>
              <p className="text-sm text-zinc-500 mt-1">by {data.funder}</p>
              <a
                href={data.grantUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors group"
              >
                View grant page
                <ExternalLink className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </a>
            </div>
            <ScoreRing score={data.scores.overall} />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">

        {/* Key Details */}
        <Section title="Key Details" icon={Info}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Amount */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
                <DollarSign className="w-4 h-4 text-teal-600" />
              </div>
              <div>
                <p className="text-xs text-zinc-400 font-medium">Grant Amount</p>
                <p className="text-sm font-semibold text-zinc-800">{amount || 'Not specified'}</p>
                {data.amountNotes && <p className="text-xs text-zinc-500 mt-0.5">{data.amountNotes}</p>}
              </div>
            </div>

            {/* Dates */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
                <CalendarDays className="w-4 h-4 text-teal-600" />
              </div>
              <div>
                <p className="text-xs text-zinc-400 font-medium">Application Window</p>
                {openDate || closeDate ? (
                  <div className="text-sm font-semibold text-zinc-800">
                    {openDate && <span>Opens {openDate}</span>}
                    {openDate && closeDate && <span className="text-zinc-300 mx-1">|</span>}
                    {closeDate && <span>Closes {closeDate}</span>}
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-zinc-800">Not specified</p>
                )}
                {data.dateNotes && <p className="text-xs text-zinc-500 mt-0.5">{data.dateNotes}</p>}
              </div>
            </div>

            {/* Application Form */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-teal-600" />
              </div>
              <div>
                <p className="text-xs text-zinc-400 font-medium">Application Form</p>
                {data.applicationFormUrl ? (
                  <a
                    href={data.applicationFormUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                  >
                    {data.applicationFormType === 'pdf' ? 'Download PDF' :
                     data.applicationFormType === 'word' ? 'Download Word doc' :
                     data.applicationFormType === 'online' ? 'Apply online' : 'Application form'}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <p className="text-sm font-semibold text-zinc-800">Not found</p>
                )}
                {data.applicationFormNotes && <p className="text-xs text-zinc-500 mt-0.5">{data.applicationFormNotes}</p>}
              </div>
            </div>

            {/* Key Contacts */}
            {data.keyContacts && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
                  <MessageSquare className="w-4 h-4 text-teal-600" />
                </div>
                <div>
                  <p className="text-xs text-zinc-400 font-medium">Contact</p>
                  <p className="text-sm text-zinc-800">{data.keyContacts}</p>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* Score Recalibration */}
        <Section title="Score Recalibration" icon={ShieldCheck}>
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-zinc-400">Overall score:</span>
              <span className="text-sm font-bold tabular-nums text-zinc-400">
                {data.scoreChanges.alignment.old ? (
                  (data.scoreChanges.alignment.old * 0.5 + data.scoreChanges.attainability.old * 0.3 + data.scoreChanges.ease.old * 0.2).toFixed(1)
                ) : '?'}
              </span>
              <span className="text-zinc-300">&rarr;</span>
              <span className={`text-sm font-bold tabular-nums px-1.5 py-0.5 rounded-md ${scoreTextClass(data.scores.overall)}`}>
                {data.scores.overall.toFixed(1)}
              </span>
            </div>
          </div>
          <ScoreChangeRow label="Alignment" change={data.scoreChanges.alignment} />
          <ScoreChangeRow label="Ease" change={data.scoreChanges.ease} />
          <ScoreChangeRow label="Attainability" change={data.scoreChanges.attainability} />
        </Section>

        {/* Eligibility Criteria */}
        {data.eligibilityCriteria.length > 0 && (
          <Section title="Eligibility Criteria" icon={ShieldCheck}>
            <ul className="space-y-2">
              {data.eligibilityCriteria.map((criterion, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-zinc-700">{criterion}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Application Checklist */}
        {data.checklist.length > 0 && (
          <Section title="Application Checklist" icon={ClipboardList}>
            <ul className="space-y-3">
              {data.checklist.map((item, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  {item.required ? (
                    <CheckCircle2 className="w-4 h-4 text-teal-600 mt-0.5 flex-shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-zinc-300 mt-0.5 flex-shrink-0" />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-800">{item.item}</span>
                      {item.required ? (
                        <span className="text-[10px] font-semibold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded">Required</span>
                      ) : (
                        <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded">Optional</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{item.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Past Recipients & Insights */}
        {data.pastRecipientNotes && (
          <Section title="Past Recipients & Insights" icon={Users}>
            <p className="text-sm text-zinc-700 leading-relaxed">{data.pastRecipientNotes}</p>
          </Section>
        )}

        {/* Additional Information */}
        {data.additionalInfo && (
          <Section title="Additional Information" icon={Info}>
            <p className="text-sm text-zinc-700 leading-relaxed">{data.additionalInfo}</p>
          </Section>
        )}

        {/* Sources */}
        {data.sourcesUsed.length > 0 && (
          <Section title="Sources" icon={Link2}>
            <ul className="space-y-2">
              {data.sourcesUsed.map((source, i) => (
                <li key={i} className="flex items-start gap-2">
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-400 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-indigo-600 hover:text-indigo-700 font-medium break-all"
                    >
                      {source.title || source.url}
                    </a>
                    {source.title && (
                      <p className="text-xs text-zinc-400 truncate">{source.url}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Footer */}
        <div className="text-center space-y-1 pt-2 pb-6">
          <p className="text-xs text-zinc-400">
            Deep search completed {new Date(data.searchedAt).toLocaleString('en-NZ', {
              day: 'numeric', month: 'short', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </p>
          <p className="text-xs text-zinc-400">
            Scores and information are AI-generated estimates. Always verify details directly with funders before applying.
          </p>
        </div>
      </div>
    </div>
  );
}
