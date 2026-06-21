import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLookupEmail } from '../src/utils/email-address.js';

test('normalizeLookupEmail trims and lowercases valid email', () => {
  assert.equal(normalizeLookupEmail('  Kindle@Kindle.COM '), 'kindle@kindle.com');
});

test('normalizeLookupEmail rejects invalid values', () => {
  assert.equal(normalizeLookupEmail(''), '');
  assert.equal(normalizeLookupEmail('not-an-email'), '');
  assert.equal(normalizeLookupEmail('a@b'), '');
});
