/**
 * Shared batch processing and concurrency utilities for pipeline scripts.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { Pool } from '@neondatabase/serverless';

// ─── Batch Processor ────────────────────────────────────────────────────────

export interface BatchOptions<T, R> {
  items: T[];
  concurrency: number;
  fn: (item: T, index: number) => Promise<R>;
  onProgress?: (done: number, total: number) => void;
  /** Log progress every N items (default: concurrency) */
  progressInterval?: number;
}

/**
 * Process items in concurrent batches, calling onProgress after each batch.
 */
export async function batchProcess<T, R>(opts: BatchOptions<T, R>): Promise<R[]> {
  const { items, concurrency, fn, onProgress, progressInterval } = opts;
  const interval = progressInterval ?? concurrency;
  const results: R[] = [];

  for (let i = 0; i < items.length; i += interval) {
    const batch = items.slice(i, i + interval);
    const batchResults = await Promise.allSettled(
      batch.map((item, j) => fn(item, i + j))
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        console.error('  Batch item failed:', r.reason);
      }
    }

    if (onProgress) {
      onProgress(Math.min(i + interval, items.length), items.length);
    }
  }

  return results;
}

// ─── Database Connection ────────────────────────────────────────────────────

export function createPool(): Pool {
  let url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    console.error('DATABASE_URL or POSTGRES_URL env var is required');
    process.exit(1);
  }
  // Use unpooled (direct) connection for pipeline scripts — avoids search_path issues
  // with Neon's transaction-mode connection pooler
  url = url.replace('-pooler.', '.');
  return new Pool({ connectionString: url });
}

// ─── CLI Helpers ────────────────────────────────────────────────────────────

export function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

export function getFlagValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

// ─── Environment Validation ─────────────────────────────────────────────────

export function requireEnv(...keys: string[]): void {
  const missing = keys.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// ─── Prerequisite Gates ─────────────────────────────────────────────────────

/**
 * Check that a prerequisite condition is met before running a pipeline step.
 * Logs a message and exits if the condition fails.
 */
export async function checkGate(
  pool: Pool,
  description: string,
  query: string,
  params: unknown[],
  check: (rows: { count: string }[]) => boolean,
): Promise<void> {
  const { rows } = await pool.query<{ count: string }>(query, params);
  if (!check(rows)) {
    console.error(`\n❌ Prerequisite gate failed: ${description}`);
    console.error('   Run the preceding pipeline step first.\n');
    await pool.end();
    process.exit(1);
  }
  console.log(`✓ Gate passed: ${description}`);
}

// ─── Pipeline Run Tracking ─────────────────────────────────────────────────

/**
 * Log the start of a pipeline step. Returns a run ID that can be used to
 * mark the step as completed.
 */
export async function startPipelineRun(
  pool: Pool,
  stepName: string,
  inputCount?: number,
): Promise<number> {
  try {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO pipeline_runs (step_name, input_count) VALUES ($1, $2) RETURNING id`,
      [stepName, inputCount ?? null],
    );
    return rows[0].id;
  } catch {
    // Table might not exist yet (pre-migration)
    return -1;
  }
}

/**
 * Mark a pipeline run as completed with output count and stats.
 */
export async function finishPipelineRun(
  pool: Pool,
  runId: number,
  outputCount: number,
  stats: Record<string, unknown> = {},
  status: 'completed' | 'failed' = 'completed',
): Promise<void> {
  if (runId < 0) return;
  try {
    await pool.query(
      `UPDATE pipeline_runs SET finished_at = NOW(), output_count = $1, stats = $2, status = $3 WHERE id = $4`,
      [outputCount, JSON.stringify(stats), status, runId],
    );
  } catch {
    // Ignore if table doesn't exist
  }
}

// ─── URL-Level Funder Dedup ────────────────────────────────────────────────

/**
 * Group funders by normalized grant_page_url and pick one canonical funder per URL.
 * Prevents processing the same page for multiple funders (cross-funder contamination).
 *
 * Returns the deduplicated list. Skipped funders are logged; callers can optionally
 * mark them in the DB via the onSkipped callback.
 */
export function dedupFundersByUrl<T extends {
  id: number;
  name: string;
  grant_page_url: string;
  grant_page_source?: string | null;
  charity_number?: string | null;
}>(
  funders: T[],
  onSkipped?: (skipped: T, canonical: T) => void,
): T[] {
  const normalizeUrl = (url: string) =>
    url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '').toLowerCase();

  const urlGroups = new Map<string, T[]>();
  for (const f of funders) {
    const norm = normalizeUrl(f.grant_page_url);
    if (!urlGroups.has(norm)) urlGroups.set(norm, []);
    urlGroups.get(norm)!.push(f);
  }

  const dedupedFunders: T[] = [];
  for (const group of Array.from(urlGroups.values())) {
    if (group.length === 1) { dedupedFunders.push(group[0]); continue; }

    // Pick canonical: prefer curated > CC-numbered > lowest id
    const sorted = [...group].sort((a, b) => {
      if (a.grant_page_source === 'curated' && b.grant_page_source !== 'curated') return -1;
      if (b.grant_page_source === 'curated' && a.grant_page_source !== 'curated') return 1;
      const aCC = a.charity_number?.startsWith('CC');
      const bCC = b.charity_number?.startsWith('CC');
      if (aCC && !bCC) return -1;
      if (bCC && !aCC) return 1;
      return a.id - b.id;
    });

    dedupedFunders.push(sorted[0]);
    for (const f of sorted.slice(1)) {
      console.log(`  ⊘ ${f.name}: shared URL with ${sorted[0].name} — skipping`);
      if (onSkipped) onSkipped(f, sorted[0]);
    }
  }

  return dedupedFunders;
}

// ─── Logging ────────────────────────────────────────────────────────────────

export function logSection(title: string): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

export function logSummary(stats: Record<string, number | string>): void {
  console.log('\n--- Summary ---');
  for (const [key, value] of Object.entries(stats)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log('');
}
