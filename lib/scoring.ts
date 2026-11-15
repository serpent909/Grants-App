/**
 * The single definition of how grant scores combine. Used by the search and
 * deep-search routes (never trust the model's own arithmetic) and by the UI.
 *
 *   overall = alignment × 0.5 + attainability × 0.3 + ease × 0.2
 */
export const SCORE_WEIGHTS = { alignment: 0.5, attainability: 0.3, ease: 0.2 } as const;

export interface SubScores {
  alignment: number;
  ease: number;
  attainability: number;
}

export function computeOverallScore({ alignment, ease, attainability }: SubScores): number {
  const raw =
    alignment * SCORE_WEIGHTS.alignment +
    attainability * SCORE_WEIGHTS.attainability +
    ease * SCORE_WEIGHTS.ease;
  return Math.round(raw * 10) / 10;
}

/** Coerce an untrusted value (e.g. model output) to a score in the range 0–10. */
export function clampScore(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(10, Math.max(0, value));
}
