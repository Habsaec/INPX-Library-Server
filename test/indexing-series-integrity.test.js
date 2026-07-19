import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { initDb, db } from '../src/db.js';
import {
  parseLine,
  enrichBookRow,
  repairBookJunctionLinks,
  createSortKey
} from '../src/inpx.js';

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

function linkSeries(bookId, seriesName, seriesNo = '1') {
  db.prepare(`
    INSERT INTO series_catalog(name, display_name, sort_name, search_name)
    VALUES(?, ?, ?, ?)
    ON CONFLICT(name) DO NOTHING
  `).run(seriesName.toLowerCase(), seriesName, createSortKey(seriesName), createSortKey(seriesName));
  const seriesId = db.prepare('SELECT id FROM series_catalog WHERE name = ?').get(seriesName.toLowerCase())?.id;
  db.prepare('INSERT OR IGNORE INTO book_series(book_id, series_id, series_no) VALUES(?, ?, ?)')
    .run(String(bookId), seriesId, seriesNo);
}

test('repairBookJunctionLinks preserves multiple series per book', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inpx-series-repair-'));
  process.env.DATA_DIR = dataDir;
  initDb();

  const row = enrichBookRow(parseLine(
    makeInpLine({ libId: '42', title: 'Title', series: 'Alpha Cycle', fileName: '42' }),
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

  linkSeries('42', 'Alpha Cycle', '1');
  linkSeries('42', 'Publisher Line', '2');

  const result = repairBookJunctionLinks();
  assert.equal(result.seriesLinksRemoved, undefined);

  const after = db.prepare(`
    SELECT sc.display_name AS name FROM book_series bs
    JOIN series_catalog sc ON sc.id = bs.series_id
    WHERE bs.book_id = ?
    ORDER BY sc.display_name
  `).all('42');
  assert.equal(after.length, 2);
  assert.deepEqual(after.map((r) => r.name), ['Alpha Cycle', 'Publisher Line']);
});

test('parseLine + enrichBookRow preserve series metadata for indexing', () => {
  const line = makeInpLine({ series: 'Harry Potter', seriesNo: '3', libId: 'hp3' });
  const row = enrichBookRow(parseLine(line, 'hp.zip'));
  assert.equal(row.series, 'Harry Potter');
  assert.equal(row.seriesNo, '3');
  assert.ok(row.seriesIndex > 0);
  assert.equal(row.seriesSort, createSortKey('Harry Potter'));
});
