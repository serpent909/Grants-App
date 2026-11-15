import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeUrl, isPrivateAddress } from '../lib/url-safety.ts';

test('isSafeUrl accepts ordinary public https URLs', () => {
  for (const url of [
    'https://example.org.nz/grants',
    'https://www.communitymatters.govt.nz/apply?round=2026',
    'https://example.com:443/path',
    'https://8.8.8.8/',
  ]) {
    assert.equal(isSafeUrl(url), true, url);
  }
});

test('isSafeUrl rejects non-https schemes and malformed input', () => {
  for (const url of [
    'http://example.com',
    'ftp://example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hi',
    'not a url',
    '',
  ]) {
    assert.equal(isSafeUrl(url), false, url);
  }
});

test('isSafeUrl rejects loopback, private and link-local targets', () => {
  for (const url of [
    'https://localhost/',
    'https://app.localhost/',
    'https://127.0.0.1/',
    'https://127.1/',                 // short form → 127.0.0.1
    'https://2130706433/',            // decimal form of 127.0.0.1
    'https://0x7f000001/',            // hex form of 127.0.0.1
    'https://0.0.0.0/',
    'https://10.0.0.5/',
    'https://172.16.0.1/',
    'https://172.31.255.255/',
    'https://192.168.1.15/',
    'https://169.254.169.254/latest/meta-data/', // cloud metadata
    'https://100.64.0.1/',            // CGNAT
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[fc00::1]/',
    'https://[fe80::1]/',
  ]) {
    assert.equal(isSafeUrl(url), false, url);
  }
});

test('isSafeUrl rejects internal names, credentials and odd ports', () => {
  for (const url of [
    'https://intranet/',
    'https://metadata.google.internal/',
    'https://db.internal/',
    'https://printer.local/',
    'https://user:pass@example.com/',
    'https://example.com:8443/',
    'https://example.com:22/',
  ]) {
    assert.equal(isSafeUrl(url), false, url);
  }
});

test('isPrivateAddress classifies addresses', () => {
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('172.32.0.1'), false); // just outside 172.16/12
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
  assert.equal(isPrivateAddress('10.1.2.3'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('not-an-ip'), true);
});
