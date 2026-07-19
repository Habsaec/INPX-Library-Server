import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSevenZipBuffer } from '../src/epub-seven-zip.js';

test('isSevenZipBuffer detects 7z magic', () => {
  assert.equal(isSevenZipBuffer(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27])), true);
  assert.equal(isSevenZipBuffer(Buffer.from('PK\x03\x04')), false);
  assert.equal(isSevenZipBuffer(Buffer.alloc(0)), false);
});
