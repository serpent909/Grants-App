import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOverallScore, clampScore } from '../lib/scoring.ts';
import { toCsv, slugForFilename } from '../lib/csv.ts';
import { sanitizeFilename, isOwnBlobUrl, attachmentDisposition } from '../lib/document-files.ts';
import { hashInviteToken, generateInviteToken, inviteTokenCandidates } from '../lib/invite-tokens.ts';
import { daysUntil, getDeadlineStatus, formatAmountRange } from '../lib/formatting.ts';

// ─── Scoring ────────────────────────────────────────────────────────────────

test('computeOverallScore applies the 50/30/20 weighting, rounded to 1dp', () => {
  assert.equal(computeOverallScore({ alignment: 8, attainability: 6, ease: 6 }), 7);
  assert.equal(computeOverallScore({ alignment: 10, attainability: 10, ease: 10 }), 10);
  assert.equal(computeOverallScore({ alignment: 7, attainability: 5, ease: 8 }), 6.6);
  assert.equal(computeOverallScore({ alignment: 0, attainability: 0, ease: 5 }), 1);
});

test('clampScore coerces untrusted model output into 0–10', () => {
  assert.equal(clampScore(7.5), 7.5);
  assert.equal(clampScore(42), 10);
  assert.equal(clampScore(-3), 0);
  assert.equal(clampScore('9'), 0);
  assert.equal(clampScore(NaN, 5), 5);
  assert.equal(clampScore(undefined, 5), 5);
});

// ─── CSV ────────────────────────────────────────────────────────────────────

test('toCsv quotes commas, quotes and newlines', () => {
  const csv = toCsv(['Name', 'Note'], [['Trust, The', 'said "hi"'], ['Line\nbreak', 5]]);
  assert.equal(csv, 'Name,Note\r\n"Trust, The","said ""hi"""\r\n"Line\nbreak",5');
});

test('toCsv neutralises spreadsheet formulas in text cells', () => {
  const csv = toCsv(['A'], [['=HYPERLINK("http://evil")'], ['+1'], ['@cmd'], ['-2+3']]);
  const lines = csv.split('\r\n').slice(1);
  for (const line of lines) assert.match(line, /^"?'/);
  // Real negative numbers are left alone.
  assert.equal(toCsv(['A'], [[-5]]), 'A\r\n-5');
});

test('slugForFilename produces a safe filename stem', () => {
  assert.equal(slugForFilename('Operational funding: 2026/27'), 'operational-funding-2026-27');
  assert.equal(slugForFilename('../../etc'), 'etc');
  assert.equal(slugForFilename('!!!'), 'export');
});

// ─── Documents ──────────────────────────────────────────────────────────────

test('sanitizeFilename strips paths and control characters', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('C:\\Users\\me\\budget.xlsx'), 'budget.xlsx');
  assert.equal(sanitizeFilename('re\x00port\n.pdf'), 'report.pdf');
  assert.equal(sanitizeFilename('...hidden'), 'hidden');
  assert.equal(sanitizeFilename(''), 'document');
  assert.equal(sanitizeFilename('a'.repeat(500)).length, 200);
});

test('isOwnBlobUrl only trusts https Vercel Blob hosts', () => {
  assert.equal(isOwnBlobUrl('https://abc123.private.blob.vercel-storage.com/org_1/file-x.pdf'), true);
  assert.equal(isOwnBlobUrl('https://abc123.public.blob.vercel-storage.com/file.pdf'), true);
  assert.equal(isOwnBlobUrl('http://abc123.private.blob.vercel-storage.com/file.pdf'), false);
  assert.equal(isOwnBlobUrl('https://attacker.example/steal'), false);
  assert.equal(isOwnBlobUrl('https://blob.vercel-storage.com.attacker.example/x'), false);
  assert.equal(isOwnBlobUrl('https://attacker.example/?x=.blob.vercel-storage.com'), false);
  assert.equal(isOwnBlobUrl('not a url'), false);
});

test('attachmentDisposition cannot be broken out of by the filename', () => {
  const header = attachmentDisposition('evil"; filename="x.exe\r\nSet-Cookie: a=b');
  assert.ok(!header.includes('\r') && !header.includes('\n'));
  assert.match(header, /^attachment; filename="[^"]*"; filename\*=UTF-8''/);
  assert.match(attachmentDisposition('Pūtea report.pdf'), /filename\*=UTF-8''P%C5%ABtea%20report\.pdf$/);
});

// ─── Invite tokens ──────────────────────────────────────────────────────────

test('invite tokens are random and only their hash is stored', () => {
  const a = generateInviteToken();
  const b = generateInviteToken();
  assert.notEqual(a.token, b.token);
  assert.equal(a.token.length, 64);
  assert.equal(a.tokenHash, hashInviteToken(a.token));
  assert.notEqual(a.tokenHash, a.token);
  assert.deepEqual(inviteTokenCandidates(a.token), [a.tokenHash, a.token]);
});

// ─── Formatting ─────────────────────────────────────────────────────────────

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('daysUntil counts whole local days and ignores non-dates', () => {
  assert.equal(daysUntil(isoInDays(0)), 0);
  assert.equal(daysUntil(isoInDays(10)), 10);
  assert.equal(daysUntil(isoInDays(-3)), -3);
  assert.equal(daysUntil('rolling'), null);
  assert.equal(daysUntil(undefined), null);
});

test('getDeadlineStatus buckets deadlines', () => {
  assert.equal(getDeadlineStatus(isoInDays(30)), 'open');
  assert.equal(getDeadlineStatus(isoInDays(3)), 'closing-soon');
  assert.equal(getDeadlineStatus(isoInDays(0)), 'closing-soon');
  assert.equal(getDeadlineStatus(isoInDays(-1)), 'passed');
  assert.equal(getDeadlineStatus('rolling'), 'rolling');
  assert.equal(getDeadlineStatus('annual - typically March'), 'rolling');
  assert.equal(getDeadlineStatus(null), null);
});

test('formatAmountRange', () => {
  assert.equal(formatAmountRange(5000, 50000), '$5k–$50k');
  assert.equal(formatAmountRange(undefined, 2_500_000), 'Up to $2.5M');
  assert.equal(formatAmountRange(500), 'From $500');
  assert.equal(formatAmountRange(), null);
});
