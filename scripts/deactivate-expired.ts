/**
 * Manage grants with past deadlines using a 3-phase lifecycle.
 *
 * Usage:
 *   npx tsx scripts/deactivate-expired.ts            # dry run
 *   npx tsx scripts/deactivate-expired.ts --apply     # apply changes
 *
 * Lifecycle:
 *   1. Active (deadline in future) — visible in search + shortlists
 *   2. Grace period (past deadline, ≤30 days) — hidden from new searches
 *      (searchGrants() already filters these), but still visible in
 *      shortlists/applications so users mid-application aren't disrupted
 *   3. Transition (past deadline, >30 days):
 *      - Recurring → convert ISO date to text schedule (e.g. "annual - typically March")
 *      - Non-recurring → deactivate (is_active = false)
 *
 * Safe to re-run — idempotent. Only touches grants with past ISO date deadlines.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }

const pool = new Pool({ connectionString: url });
const APPLY = process.argv.includes('--apply');
const GRACE_PERIOD_DAYS = 30;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Convert an ISO date + round_frequency into an evergreen text schedule. */
function toTextSchedule(isoDate: string, roundFrequency: string | null): string {
  const month = MONTH_NAMES[new Date(isoDate).getMonth()];
  switch (roundFrequency) {
    case 'quarterly':
      return 'quarterly';
    case 'biannual': {
      // Estimate the other round ~6 months away
      const otherIdx = (new Date(isoDate).getMonth() + 6) % 12;
      return `biannual - typically ${month} and ${MONTH_NAMES[otherIdx]}`;
    }
    case 'annual':
    default:
      return `annual - typically ${month}`;
  }
}

interface ExpiredGrant {
  id: string;
  name: string;
  funder: string;
  deadline: string;
  is_recurring: boolean | null;
  round_frequency: string | null;
  days_past: number;
}

async function main() {
  const { rows } = await pool.query<ExpiredGrant>(`
    SELECT
      g.id, g.name, c.name as funder, g.deadline,
      g.is_recurring, g.round_frequency,
      (CURRENT_DATE - g.deadline::date) AS days_past
    FROM grants g
    JOIN charities c ON c.id = g.funder_id
    WHERE g.is_active
      AND g.deadline IS NOT NULL
      AND g.deadline ~ '^\\d{4}-\\d{2}-\\d{2}'
      AND g.deadline::date < CURRENT_DATE
    ORDER BY g.deadline
  `);

  if (rows.length === 0) {
    console.log('No active grants with past deadlines.');
    await pool.end();
    return;
  }

  // Categorise
  const inGrace: ExpiredGrant[] = [];
  const convertToSchedule: ExpiredGrant[] = [];
  const deactivate: ExpiredGrant[] = [];

  for (const row of rows) {
    if (row.days_past <= GRACE_PERIOD_DAYS) {
      inGrace.push(row);
    } else if (row.is_recurring) {
      convertToSchedule.push(row);
    } else {
      deactivate.push(row);
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────

  console.log(`Found ${rows.length} active grants with past deadlines:\n`);

  if (inGrace.length > 0) {
    console.log(`  Grace period (≤${GRACE_PERIOD_DAYS} days past, no action):`);
    for (const r of inGrace) {
      const tag = r.is_recurring ? 'recurring' : 'one-off';
      console.log(`    ${r.deadline.slice(0, 10)} (${r.days_past}d ago, ${tag})  ${r.name.slice(0, 45)}  — ${r.funder.slice(0, 30)}`);
    }
    console.log();
  }

  if (convertToSchedule.length > 0) {
    console.log(`  Convert to text schedule (recurring, >${GRACE_PERIOD_DAYS} days past):`);
    for (const r of convertToSchedule) {
      const schedule = toTextSchedule(r.deadline, r.round_frequency);
      console.log(`    ${r.deadline.slice(0, 10)} → "${schedule}"  ${r.name.slice(0, 40)}  — ${r.funder.slice(0, 30)}`);
    }
    console.log();
  }

  if (deactivate.length > 0) {
    console.log(`  Deactivate (non-recurring, >${GRACE_PERIOD_DAYS} days past):`);
    for (const r of deactivate) {
      console.log(`    ${r.deadline.slice(0, 10)} (${r.days_past}d ago)  ${r.name.slice(0, 45)}  — ${r.funder.slice(0, 30)}`);
    }
    console.log();
  }

  console.log(`Summary:`);
  console.log(`  In grace period (no action):  ${inGrace.length}`);
  console.log(`  Convert to text schedule:     ${convertToSchedule.length}`);
  console.log(`  Deactivate:                   ${deactivate.length}`);

  // ── Apply ─────────────────────────────────────────────────────────────────

  if (!APPLY) {
    console.log(`\nDry run. Run with --apply to make changes.`);
    await pool.end();
    return;
  }

  // Convert recurring grants to text schedules
  let converted = 0;
  for (const r of convertToSchedule) {
    const schedule = toTextSchedule(r.deadline, r.round_frequency);
    await pool.query(
      `UPDATE grants SET
        deadline = $1,
        scrape_notes = $2
      WHERE id = $3`,
      [schedule, `deadline converted to schedule: was ${r.deadline.slice(0, 10)}`, r.id],
    );
    converted++;
  }

  // Deactivate non-recurring grants
  let deactivated = 0;
  if (deactivate.length > 0) {
    const ids = deactivate.map(r => r.id);
    const result = await pool.query(
      `UPDATE grants SET
        is_active = false,
        scrape_notes = 'expired: one-off grant, deadline passed'
      WHERE id = ANY($1)`,
      [ids],
    );
    deactivated = result.rowCount ?? 0;
  }

  console.log(`\nApplied:`);
  console.log(`  Converted to text schedule: ${converted}`);
  console.log(`  Deactivated:               ${deactivated}`);

  const { rows: active } = await pool.query(`SELECT COUNT(*) AS n FROM grants WHERE is_active`);
  console.log(`\nActive grants in DB: ${active[0].n}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
