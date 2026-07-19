import test from 'node:test';
import assert from 'node:assert/strict';
import { bookCardDataAttrs, batchBookIdDataAttr, bookIdDataAttr } from '../src/templates/shared.js';

const UNSAFE_ID = '1:728141\x00fb2-728000-728999.7z\x00728141\x00fb2';

test('bookCardDataAttrs omits raw data-book-id for NUL-byte ids', () => {
  const attrs = bookCardDataAttrs(UNSAFE_ID);
  assert.match(attrs, /data-book-id-ref="/);
  assert.doesNotMatch(attrs, /data-book-id="1:728141/);
});

test('bookCardDataAttrs keeps legacy data-book-id for safe ids', () => {
  const attrs = bookCardDataAttrs('abc.fb2');
  assert.match(attrs, /data-book-id-ref="/);
  assert.match(attrs, /data-book-id="abc\.fb2"/);
});

test('batchBookIdDataAttr uses ref for unsafe ids', () => {
  const attrs = batchBookIdDataAttr(UNSAFE_ID);
  assert.match(attrs, /data-batch-book-id-ref="/);
  assert.doesNotMatch(attrs, /data-batch-book-id="/);
});

test('bookIdDataAttr is safe in HTML attribute context', () => {
  const attrs = bookIdDataAttr(UNSAFE_ID);
  assert.doesNotMatch(attrs, /\x00/);
  assert.doesNotMatch(attrs, /[\x00-\x1f]/);
});
