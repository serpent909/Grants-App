import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, cleanName, passwordResetEmail, verifyEmailEmail, invitationEmail,
} from '../lib/email-templates.ts';
import {
  generateAuthToken, hashAuthToken, emailRateLimitKey, isSessionStale,
  PASSWORD_RESET_TTL_MS, EMAIL_VERIFICATION_TTL_MS,
} from '../lib/auth-tokens.ts';
import { resolveAppUrl } from '../lib/app-url.ts';
import { sendEmail } from '../lib/email.ts';

// ─── Templates ──────────────────────────────────────────────────────────────

test('escapeHtml neutralises markup characters', () => {
  assert.equal(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
});

test('cleanName strips control characters and caps the length', () => {
  assert.equal(cleanName('  Helping\r\nHands\tTrust  '), 'Helping Hands Trust');
  assert.equal(cleanName('x'.repeat(200)).length, 80);
  assert.equal(cleanName(''), '');
});

test('every email carries its link in both the HTML and the text alternative', () => {
  const url = 'https://grants.example.org.nz/reset-password/abc123';
  for (const email of [
    passwordResetEmail({ url }),
    verifyEmailEmail({ url }),
    invitationEmail({ url, orgName: 'Helping Hands Trust', inviterName: 'Jane' }),
  ]) {
    assert.ok(email.subject.length > 0 && !/[\r\n]/.test(email.subject));
    assert.ok(email.html.includes(`href="${url}"`));
    assert.ok(email.text.includes(url));
    assert.ok(!/<[a-z]/i.test(email.text), 'text alternative contains no markup');
    assert.match(email.html, /<html lang="en">/);
  }
});

test('emails contain no images or remote assets (no tracking)', () => {
  const { html } = passwordResetEmail({ url: 'https://example.org/x' });
  assert.ok(!/<img|<link|<script|url\(/i.test(html));
});

test('invitation email escapes user-supplied names', () => {
  const email = invitationEmail({
    url: 'https://example.org/invite/t',
    orgName: '<script>alert(1)</script> Trust',
    inviterName: 'Eve"><img src=x>',
  });
  assert.ok(!email.html.includes('<script>'));
  assert.ok(!email.html.includes('<img'));
  assert.ok(email.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; Trust'));
  // Line breaks in a name cannot split the subject line.
  const multi = invitationEmail({ url: 'https://example.org/i', orgName: 'A\r\nBcc: x@y.z', inviterName: '' });
  assert.ok(!/[\r\n]/.test(multi.subject));
  assert.ok(multi.text.includes('A colleague has invited you'));
});

test('query strings in links survive HTML escaping', () => {
  const { html, text } = verifyEmailEmail({ url: 'https://example.org/v?a=1&b=2' });
  assert.ok(html.includes('href="https://example.org/v?a=1&amp;b=2"'));
  assert.ok(text.includes('https://example.org/v?a=1&b=2'));
});

// ─── Tokens ─────────────────────────────────────────────────────────────────

test('auth tokens are random and only their hash is stored', () => {
  const a = generateAuthToken();
  const b = generateAuthToken();
  assert.notEqual(a.token, b.token);
  assert.equal(a.token.length, 64);
  assert.equal(a.tokenHash, hashAuthToken(a.token));
  assert.notEqual(a.tokenHash, a.token);
  assert.match(a.tokenHash, /^[0-9a-f]{64}$/);
});

test('token lifetimes: reset 1 hour, verification 24 hours', () => {
  assert.equal(PASSWORD_RESET_TTL_MS, 3_600_000);
  assert.equal(EMAIL_VERIFICATION_TTL_MS, 86_400_000);
});

test('emailRateLimitKey is case/whitespace-insensitive and does not contain the address', () => {
  const key = emailRateLimitKey('  Jane@Example.org ');
  assert.equal(key, emailRateLimitKey('jane@example.org'));
  assert.notEqual(key, emailRateLimitKey('john@example.org'));
  assert.ok(!key.includes('jane'));
});

// ─── Session invalidation ───────────────────────────────────────────────────

test('isSessionStale rejects sessions that signed in before a password change', () => {
  const changedAt = Date.parse('2026-11-15T10:00:00Z');
  assert.equal(isSessionStale(changedAt - 1, changedAt), true);
  assert.equal(isSessionStale(changedAt, changedAt), false);
  assert.equal(isSessionStale(changedAt + 1000, changedAt), false);
});

test('isSessionStale: no password change means no session is stale', () => {
  assert.equal(isSessionStale(Date.now(), null), false);
  assert.equal(isSessionStale(null, null), false);
  assert.equal(isSessionStale(undefined, undefined), false);
  assert.equal(isSessionStale(Date.now(), NaN), false);
});

test('isSessionStale: sessions with no sign-in time predate any password change', () => {
  assert.equal(isSessionStale(null, Date.now()), true);
  assert.equal(isSessionStale(undefined, Date.now()), true);
});

// ─── App URL ────────────────────────────────────────────────────────────────

test('resolveAppUrl prefers configuration and normalises it', () => {
  assert.equal(
    resolveAppUrl({ configured: 'https://grants.example.org.nz/', requestOrigin: 'https://evil.example', isProduction: true }),
    'https://grants.example.org.nz',
  );
  assert.equal(
    resolveAppUrl({ vercelProductionHost: 'grants.example.org.nz', isProduction: true }),
    'https://grants.example.org.nz',
  );
});

test('resolveAppUrl never trusts the request origin in production', () => {
  assert.throws(
    () => resolveAppUrl({ requestOrigin: 'https://evil.example', isProduction: true }),
    /APP_URL/,
  );
  assert.throws(
    () => resolveAppUrl({ configured: 'javascript:alert(1)', requestOrigin: 'https://evil.example', isProduction: true }),
    /APP_URL/,
  );
});

test('resolveAppUrl falls back to the request origin in development', () => {
  assert.equal(resolveAppUrl({ requestOrigin: 'http://localhost:3000', isProduction: false }), 'http://localhost:3000');
  assert.equal(resolveAppUrl({ isProduction: false }), 'http://localhost:3000');
});

// ─── sendEmail without provider credentials ─────────────────────────────────

const message = { to: 'jane@example.org', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  return fn().finally(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

test('sendEmail logs instead of sending when unconfigured in development', async t => {
  const log = t.mock.method(console, 'log', () => {});
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  await withEnv({ RESEND_API_KEY: undefined, EMAIL_FROM: undefined, NODE_ENV: 'development' }, async () => {
    assert.equal(await sendEmail(message), 'logged');
  });
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(log.mock.callCount(), 1);
  assert.match(String(log.mock.calls[0].arguments[0]), /jane@example\.org/);
});

test('sendEmail fails clearly when unconfigured in production', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  await withEnv({ RESEND_API_KEY: undefined, EMAIL_FROM: undefined, NODE_ENV: 'production' }, async () => {
    await assert.rejects(sendEmail(message), /Email is not configured/);
  });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('sendEmail posts to Resend with the key and both bodies', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{"id":"1"}', { status: 200 }));
  await withEnv({ RESEND_API_KEY: 'test_key', EMAIL_FROM: 'GrantSearch NZ <noreply@example.org>' }, async () => {
    assert.equal(await sendEmail(message), 'sent');
  });
  assert.equal(fetchMock.mock.callCount(), 1);
  const [url, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer test_key');
  assert.deepEqual(JSON.parse(String(init.body)), {
    from: 'GrantSearch NZ <noreply@example.org>',
    to: ['jane@example.org'],
    subject: 'Hi',
    html: '<p>Hi</p>',
    text: 'Hi',
  });
});

test('sendEmail throws when the provider rejects the message', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{"message":"domain not verified"}', { status: 403 }));
  await withEnv({ RESEND_API_KEY: 'test_key', EMAIL_FROM: 'noreply@example.org' }, async () => {
    await assert.rejects(sendEmail(message), /responded 403/);
  });
});
