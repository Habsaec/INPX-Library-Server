import { test } from 'node:test';
import assert from 'node:assert';
import { inpEntryFingerprint, inpEntryChanged } from '../src/inpx.js';

test('inpEntryFingerprint captures size and crc metadata', () => {
  const fp = inpEntryFingerprint({
    uncompressedSize: 1000,
    compressedSize: 400,
    crc32: 42
  });
  assert.deepStrictEqual(fp, { u: 1000, c: 400, crc: 42 });
});

test('inpEntryChanged detects legacy numeric fingerprint', () => {
  const entry = { uncompressedSize: 500, compressedSize: 200, crc32: 1 };
  assert.strictEqual(inpEntryChanged(entry, 500), false);
  assert.strictEqual(inpEntryChanged(entry, 501), true);
  assert.strictEqual(inpEntryChanged(entry, undefined), true);
});

test('inpEntryChanged detects object fingerprint changes', () => {
  const entry = { uncompressedSize: 500, compressedSize: 200, crc32: 7 };
  const prev = inpEntryFingerprint(entry);
  assert.strictEqual(inpEntryChanged(entry, prev), false);
  assert.strictEqual(inpEntryChanged({ ...entry, crc32: 8 }, prev), true);
  assert.strictEqual(inpEntryChanged({ ...entry, compressedSize: 201 }, prev), true);
});
