import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Ratelimit } from '@upstash/ratelimit';
import { getRateLimitOutcome, checkRateLimit, canSendEmail } from '../lib/rate-limit.ts';

// The limiter only does anything in production, so each test sets NODE_ENV
// for its own duration and restores it afterwards.
function inEnv(value: string, fn: () => Promise<void>) {
  return async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    const previousError = console.error;
    env.NODE_ENV = value;
    console.error = () => {}; // the "not configured" / "Redis error" logs are expected here
    try {
      await fn();
    } finally {
      env.NODE_ENV = previous;
      console.error = previousError;
    }
  };
}

/** A stand-in limiter: only `.limit()` is ever called. */
function fakeLimiter(limit: () => Promise<{ success: boolean; reset: number }>): Ratelimit {
  return { limit } as unknown as Ratelimit;
}

const allowing = fakeLimiter(async () => ({ success: true, reset: Date.now() + 60_000 }));
const blocking = fakeLimiter(async () => ({ success: false, reset: Date.now() + 30_000 }));
const broken = fakeLimiter(async () => { throw new Error('redis down'); });

test('outside production nothing is limited', inEnv('development', async () => {
  assert.deepEqual(await getRateLimitOutcome(null, 'k'), { state: 'ok' });
  assert.deepEqual(await getRateLimitOutcome(blocking, 'k'), { state: 'ok' });
  assert.equal(await checkRateLimit(null, 'k', { failClosed: true }), null);
}));

test('production: a working limiter allows or limits', inEnv('production', async () => {
  assert.deepEqual(await getRateLimitOutcome(allowing, 'k'), { state: 'ok' });
  const limited = await getRateLimitOutcome(blocking, 'k');
  assert.equal(limited.state, 'limited');
  assert.ok(limited.retryAfterSeconds! >= 1 && limited.retryAfterSeconds! <= 30);
}));

test('production: no limiter, or a failing one, is reported as unavailable', inEnv('production', async () => {
  assert.equal((await getRateLimitOutcome(null, 'k')).state, 'unavailable');
  assert.equal((await getRateLimitOutcome(broken, 'k')).state, 'unavailable');
}));

test('email is only sent when a limit is actually being enforced', () => {
  assert.equal(canSendEmail({ state: 'ok' }), true);
  assert.equal(canSendEmail({ state: 'limited', retryAfterSeconds: 5 }), false);
  assert.equal(canSendEmail({ state: 'unavailable' }), false);
});

test('checkRateLimit fails open by default and closed on request', inEnv('production', async () => {
  // Default: an unavailable limiter lets the request through.
  assert.equal(await checkRateLimit(null, 'k'), null);
  assert.equal(await checkRateLimit(broken, 'k'), null);

  // failClosed: an unavailable limiter refuses with 503.
  for (const limiter of [null, broken]) {
    const refused = await checkRateLimit(limiter, 'k', { failClosed: true });
    assert.equal(refused?.status, 503);
    assert.equal(typeof (await refused!.json()).error, 'string');
  }

  // A working limiter behaves the same either way.
  assert.equal(await checkRateLimit(allowing, 'k', { failClosed: true }), null);
  const blocked = await checkRateLimit(blocking, 'k', { failClosed: true });
  assert.equal(blocked?.status, 429);
  assert.ok(Number(blocked!.headers.get('Retry-After')) >= 1);
}));
