import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { initDb, db, setSetting, getSetting, rebuildActiveBooksView, countIndexedDeletedBooks } from '../src/db.js';
import { getBookById, parseLine, enrichBookRow } from '../src/inpx.js';

const SEP = String.fromCharCode(4);

function makeInpLine(fields) {
  const defaults = {
    authors: 'Author',
    genres: 'sf',
    title: 'Book',
    series: '',
    seriesNo: '',
    fileName: 'book',
    size: '100',
    libId: '1',
    deleted: '0',
    ext: 'fb2',
    date: '',
    lang: 'ru',
    libRate: '0',
    keywords: ''
  };
  const merged = { ...defaults, ...fields };
  return [
    merged.authors, merged.genres, merged.title, merged.series, merged.seriesNo,
    merged.fileName, merged.size, merged.libId, merged.deleted, merged.ext,
    merged.date, merged.lang, merged.libRate, merged.keywords
  ].join(SEP);
}

function insertBook(fields) {
  const row = enrichBookRow(parseLine(
    makeInpLine(fields),
    'test.zip'
  ));
  db.prepare(`
    INSERT INTO books (
      id, title, authors, genres, series, series_no, title_sort, author_sort,
      series_sort, series_index, title_search, authors_search, series_search,
      genres_search, keywords_search, file_name, archive_name, size, lib_id, deleted,
      ext, date, lang, keywords, lib_rate, source_id
    ) VALUES (
      @id, @title, @authors, @genres, @series, @seriesNo, @titleSort, @authorSort,
      @seriesSort, @seriesIndex, @titleSearch, @authorsSearch, @seriesSearch,
      @genresSearch, @keywordsSearch, @fileName, @archiveName, @size, @libId, @deleted,
      @ext, @date, @lang, @keywords, @libRate, @sourceId
    )
  `).run({ ...row, sourceId: null });
  return row.id;
}

let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inpx-show-deleted-'));
  process.env.DATA_DIR = dataDir;
  initDb();
  insertBook({ libId: '100', title: 'Active Book', deleted: '0', fileName: '100' });
  insertBook({ libId: '101', title: 'Deleted Book', deleted: '1', fileName: '101' });
  insertBook({ libId: '102', title: 'Suppressed Soft-Delete', deleted: '1', fileName: '102' });
  db.prepare(`
    INSERT INTO suppressed_books(book_id, title, authors, reason)
    VALUES (?, ?, ?, 'user')
  `).run('102', 'Suppressed Soft-Delete', 'Author');
  setSetting('show_deleted_books', '0');
  await rebuildActiveBooksView();
});

after(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('parseLine maps INPX DEL to deleted', () => {
  const row = parseLine(makeInpLine({ deleted: '1', libId: '9' }), 'a.zip');
  assert.equal(row.deleted, 1);
});

test('deleted books stay hidden when show_deleted_books is off', () => {
  assert.equal(getSetting('show_deleted_books'), '0');
  assert.ok(getBookById('100'));
  assert.equal(getBookById('101'), null);
  assert.equal(getBookById('102'), null);
  assert.equal(countIndexedDeletedBooks(), 1);
});

test('show_deleted_books reveals INPX deleted but not suppressed soft-deletes', async () => {
  setSetting('show_deleted_books', '1');
  await rebuildActiveBooksView();
  assert.ok(getBookById('100'));
  const deleted = getBookById('101');
  assert.ok(deleted);
  assert.equal(deleted.deleted, 1);
  assert.equal(deleted.title, 'Deleted Book');
  assert.equal(getBookById('102'), null);
});

test('turning show_deleted_books off hides them again', async () => {
  setSetting('show_deleted_books', '0');
  await rebuildActiveBooksView();
  assert.ok(getBookById('100'));
  assert.equal(getBookById('101'), null);
});
