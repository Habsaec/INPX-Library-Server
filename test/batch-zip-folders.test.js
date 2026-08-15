import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeZipFolderName, zipSeriesFolderName } from '../src/routes/download.js';

test('sanitizeZipFolderName strips path separators and reserved names', () => {
  assert.strictEqual(sanitizeZipFolderName('Ведьмак'), 'Ведьмак');
  assert.strictEqual(sanitizeZipFolderName('A / B: C'), 'A _ B_ C');
  assert.strictEqual(sanitizeZipFolderName('CON'), 'CON_');
  assert.ok(sanitizeZipFolderName('x'.repeat(200)).length <= 80);
});

test('zipSeriesFolderName uses series display name and a fallback folder', () => {
  assert.strictEqual(
    zipSeriesFolderName({ series: 'raw', seriesList: [{ name: 'raw', displayName: 'Ведьмак' }] }),
    'Ведьмак'
  );
  assert.strictEqual(zipSeriesFolderName({ series: 'Основание' }), 'Основание');
  const outside = zipSeriesFolderName({ series: '', seriesList: [] });
  assert.ok(outside.length > 0);
  assert.notStrictEqual(outside, 'series');
});
