'use client';

import { CheckCircle2 } from 'lucide-react';
import { scoreColor, scoreTextClass } from '@/lib/formatting';

interface Scores {
  alignment: number;
  ease: number;
  attainability: number;
  overall: number;
}

/** Filled circle showing the overall score. `verified` adds the deep-research tick. */
export function ScoreBadge({ score, size = 'md', verified = false }: {
  score?: number;
  size?: 'sm' | 'md';
  verified?: boolean;
}) {
  const s = score ?? 0;
  return (
    <div className="relative flex-shrink-0">
      <div
        className={`rounded-full flex items-center justify-center font-bold text-white tabular-nums ${
          size === 'sm' ? 'w-9 h-9 text-xs' : 'w-10 h-10 text-sm'
        }`}
        style={{ backgroundColor: scoreColor(s) }}
        aria-label={`Overall score ${s.toFixed(1)} out of 10`}
      >
        {s.toFixed(1)}
      </div>
      {verified && (
        // A plain element, not a tooltip trigger: this badge is rendered inside
        // the row's own <button>, and a button nested in a button is invalid
        // HTML (and unreachable by keyboard).
        <span
          role="img"
          aria-label="Deep research completed"
          title="Deep research completed"
          className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center ring-2 ring-white dark:ring-zinc-800"
        >
          <CheckCircle2 className="w-2.5 h-2.5 text-white" aria-hidden />
        </span>
      )}
    </div>
  );
}

/** Ring gauge used for a funder's best score. */
export function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const s = score ?? 0;
  const strokeW = 4;
  const r = (size - strokeW * 2) / 2;
  const circ = 2 * Math.PI * r;
  const arc = Math.max(0, Math.min(1, s / 10)) * circ;

  return (
    <div
      className="relative flex-shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Best score ${s.toFixed(1)} out of 10`}
    >
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden>
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" className="stroke-zinc-100 dark:stroke-zinc-700" strokeWidth={strokeW}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={scoreColor(s)} strokeWidth={strokeW}
          strokeDasharray={`${arc} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-bold text-zinc-800 dark:text-zinc-200 tabular-nums" style={{ fontSize: size < 44 ? 10 : 12 }}>
          {s.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

/** Small labelled sub-score chip. */
export function ScorePill({ score, label }: { score?: number; label: string }) {
  const s = score ?? 0;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md tabular-nums ${scoreTextClass(s)}`}>
        {s.toFixed(1)}
      </span>
      <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-medium uppercase tracking-wide">{label}</span>
    </div>
  );
}

/** The three sub-scores side by side (Align / Ease / Win). */
export function SubScores({ scores, className = '' }: { scores?: Partial<Scores>; className?: string }) {
  return (
    <div className={`items-end gap-3 flex-shrink-0 ${className}`}>
      <ScorePill score={scores?.alignment} label="Align" />
      <ScorePill score={scores?.ease} label="Ease" />
      <ScorePill score={scores?.attainability} label="Win" />
    </div>
  );
}

/** Bar-chart breakdown of the three sub-scores plus the overall. */
export function ScoreBreakdown({ scores }: { scores?: Partial<Scores> }) {
  const rows = [
    { label: 'Alignment', score: scores?.alignment ?? 0, weight: '50%' },
    { label: 'Attainability', score: scores?.attainability ?? 0, weight: '30%' },
    { label: 'Ease', score: scores?.ease ?? 0, weight: '20%' },
  ];
  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
      <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">Score breakdown</p>
      <div className="space-y-2.5">
        {rows.map(({ label, score, weight }) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {label} <span className="text-zinc-400 dark:text-zinc-500">· {weight}</span>
            </span>
            <div className="flex items-center gap-2">
              <div className="w-20 h-1.5 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${score * 10}%`, backgroundColor: scoreColor(score) }}
                />
              </div>
              <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 tabular-nums w-6 text-right">
                {score.toFixed(1)}
              </span>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-700">
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Overall</span>
          <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
            {(scores?.overall ?? 0).toFixed(1)}
            <span className="text-xs font-normal text-zinc-400 dark:text-zinc-500">/10</span>
          </span>
        </div>
      </div>
    </div>
  );
}
