import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDownloadBaseName,
  contentDispositionAttachment,
  DEFAULT_DOWNLOAD_FILENAME_STYLE,
  getDownloadFilenameStyle,
  normalizeDownloadFilenameStyle,
  setDownloadFilenameStyle
} from '../src/download-filename.js';

const jestBook = {
  id: '1',
  authors: 'Uolles,Devid Foster',
  title: 'Бесконечная шутка',
  series: 'Великие романы',
  seriesNo: '0',
  fileName: '12345'
};

afterEach(() => {
  setDownloadFilenameStyle(DEFAULT_DOWNLOAD_FILENAME_STYLE);
});

test('default style transliterates author title series', () => {
  assert.equal(getDownloadFilenameStyle(), 'translit-full');
  assert.equal(
    buildDownloadBaseName(jestBook),
    'Uolles Devid Foster Beskonechnaya shutka Velikie romany 0'
  );
});

test('title style uses catalog title without transliteration', () => {
  assert.equal(buildDownloadBaseName(jestBook, 'title'), 'Бесконечная шутка');
});

test('author-title style keeps original script', () => {
  assert.equal(
    buildDownloadBaseName(jestBook, 'author-title'),
    'Uolles Devid Foster — Бесконечная шутка'
  );
});

test('full style keeps original script including series', () => {
  assert.equal(
    buildDownloadBaseName(jestBook, 'full'),
    'Uolles Devid Foster Бесконечная шутка Великие романы 0'
  );
});

test('setDownloadFilenameStyle changes the active default', () => {
  setDownloadFilenameStyle('title');
  assert.equal(getDownloadFilenameStyle(), 'title');
  assert.equal(buildDownloadBaseName(jestBook), 'Бесконечная шутка');
});

test('unknown style falls back to translit-full', () => {
  assert.equal(normalizeDownloadFilenameStyle('nope'), 'translit-full');
  assert.equal(
    buildDownloadBaseName(jestBook, 'nope'),
    'Uolles Devid Foster Beskonechnaya shutka Velikie romany 0'
  );
});

test('sanitize strips reserved filename characters', () => {
  const name = buildDownloadBaseName({ title: 'A / B: C?' }, 'title');
  assert.equal(name, 'A _ B_ C_');
});

test('contentDispositionAttachment uses RFC 5987 for Unicode names', () => {
  const header = contentDispositionAttachment('Бесконечная шутка.epub');
  assert.match(header, /filename="Beskonechnaya shutka.epub"/);
  assert.match(header, /filename\*=UTF-8''/);
  assert.ok(header.includes(encodeURIComponent('Бесконечная шутка.epub')));
});

test('contentDispositionAttachment keeps ASCII names unencoded', () => {
  assert.equal(
    contentDispositionAttachment('Uolles Devid Foster Beskonechnaya shutka.epub'),
    'attachment; filename="Uolles Devid Foster Beskonechnaya shutka.epub"'
  );
});
