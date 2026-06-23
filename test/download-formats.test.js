import { test } from 'node:test';
import assert from 'node:assert';
import {
  getAvailableDownloadFormats,
  setDisabledDownloadFormats,
  isDownloadFormatEnabled,
  getConfiguredDownloadFormats
} from '../src/download-formats.js';

test('getAvailableDownloadFormats respects disabled formats for fb2 books', () => {
  setDisabledDownloadFormats(['epub2', 'epub3']);
  const formats = getAvailableDownloadFormats({ ext: 'fb2' });
  assert.ok(formats.includes('fb2'));
  assert.ok(!formats.includes('epub2'));
  assert.ok(!formats.includes('epub3'));
  setDisabledDownloadFormats([]);
});

test('native non-fb2 formats stay available when unrelated formats are disabled', () => {
  setDisabledDownloadFormats(['epub2']);
  const formats = getAvailableDownloadFormats({ ext: 'pdf' });
  assert.deepStrictEqual(formats, ['pdf']);
  setDisabledDownloadFormats([]);
});

test('getConfiguredDownloadFormats always includes fb2', () => {
  const formats = getConfiguredDownloadFormats();
  assert.ok(formats.includes('fb2'));
});

test('isDownloadFormatEnabled ignores unknown format codes', () => {
  setDisabledDownloadFormats(['epub2']);
  assert.strictEqual(isDownloadFormatEnabled('pdf'), true);
  assert.strictEqual(isDownloadFormatEnabled('epub2'), false);
  setDisabledDownloadFormats([]);
});
