import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeStringEqual } from '../src/auth.js';

test('timingSafeStringEqual accepts matching non-empty strings', () => {
  assert.equal(timingSafeStringEqual('invite-ok', 'invite-ok'), true);
});

test('timingSafeStringEqual rejects mismatches and empty values', () => {
  assert.equal(timingSafeStringEqual('invite-ok', 'invite-no'), false);
  assert.equal(timingSafeStringEqual('ab', 'abc'), false);
  assert.equal(timingSafeStringEqual('', ''), false);
  assert.equal(timingSafeStringEqual('', 'x'), false);
});
