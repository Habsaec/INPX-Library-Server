import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initDb,
  db,
  rebuildBooksFtsFromContentSync,
  setMeta,
  getBooksFtsStatus,
  invalidateBooksFtsHealthCache,
  isBooksFtsUsable
} from '../src/db.js';
import { createSortKey, searchBooks, buildSearchRecoveryHints, opdsSearchAuthors, listAuthors } from '../src/inpx.js';

const BOOK_ID = 'peshkom-nad-oblakami';
const TITLE = 'Пешком над облаками';
const AUTHORS = 'Георгий Михайлович Садовников';

before(() => {
  initDb();
  db.prepare('DELETE FROM books WHERE id = ?').run(BOOK_ID);
  db.prepare(`
    INSERT INTO books (
      id, title, authors, genres, series, series_no, title_sort, author_sort,
      series_sort, series_index, title_search, authors_search, series_search,
      genres_search, keywords_search, file_name, archive_name, size, lib_id, deleted,
      ext, date, lang, keywords, lib_rate, source_id
    ) VALUES (
      ?, ?, ?, '', '', '', ?, ?,
      '', 0, ?, ?, '',
      '', '', 'x.fb2', 'a.zip', 1, ?, 0,
      'fb2', '', 'ru', '', 0, NULL
    )
  `).run(
    BOOK_ID,
    TITLE,
    AUTHORS,
    createSortKey(TITLE),
    createSortKey(AUTHORS),
    createSortKey(TITLE),
    createSortKey(AUTHORS),
    BOOK_ID,
  );
  rebuildBooksFtsFromContentSync();
  setMeta('books_fts_dirty', '0');
  invalidateBooksFtsHealthCache();
});

test('exact multi-word title is found via default search', () => {
  const result = searchBooks({ query: TITLE, page: 1, pageSize: 24, field: 'all' });
  const ids = result.items.map((row) => row.id);
  assert.ok(result.total > 0, `expected total > 0, got ${result.total}`);
  assert.ok(ids.includes(BOOK_ID), `expected ${BOOK_ID} in ${JSON.stringify(result.items.map((r) => r.title))}`);
  assert.equal(ids[0], BOOK_ID, 'exact title should rank first');
});

test('FTS MATCH finds multi-word Cyrillic title', () => {
  const tokens = createSortKey(TITLE).split(/\s+/).filter(Boolean);
  const match = tokens.map((t) => `"${t}"*`).join(' ');
  const rows = db.prepare('SELECT id, title_search FROM books_fts WHERE books_fts MATCH ?').all(match);
  assert.ok(rows.some((r) => r.id === BOOK_ID), `FTS miss for ${match}: ${JSON.stringify(rows)}`);
});

test('LIKE fallback finds multi-word title when FTS is dirty', () => {
  setMeta('books_fts_dirty', '1');
  invalidateBooksFtsHealthCache();
  try {
    assert.equal(isBooksFtsUsable(), false);
    const result = searchBooks({ query: TITLE, page: 1, pageSize: 24, field: 'all' });
    assert.ok(
      result.items.some((row) => row.id === BOOK_ID),
      'LIKE fallback must find multi-word title while FTS is unusable'
    );
  } finally {
    setMeta('books_fts_dirty', '0');
    invalidateBooksFtsHealthCache();
  }
});

test('single-token prefix still finds the title', () => {
  const prefix = searchBooks({ query: 'пешком', page: 1, pageSize: 24, field: 'title' });
  assert.ok(prefix.items.some((row) => row.id === BOOK_ID), 'single prefix token must match');
});

test('stemmed inflection finds title via FTS expand', () => {
  /* "облак" is stem of "облаками"; with expand, single-token query should hit. */
  const result = searchBooks({ query: 'облаками', page: 1, pageSize: 24, field: 'title' });
  assert.ok(result.items.some((row) => row.id === BOOK_ID), 'inflected title token must match via stem expand');
});

test('FTS health reports ok after rebuild', () => {
  invalidateBooksFtsHealthCache();
  const status = getBooksFtsStatus({ force: true, recover: false });
  assert.equal(status.status, 'ok');
  assert.ok(status.ftsDocCount >= 1);
  assert.ok(isBooksFtsUsable());
});

test('recovery hints tip try_authors when authors exist', () => {
  db.prepare(`
    INSERT OR REPLACE INTO authors (name, display_name, sort_name, search_name, book_count)
    VALUES ('uniqueauthorxyz', 'Unique Author XYZ', 'uniqueauthorxyz', 'uniqueauthorxyz', 1)
  `).run();
  const hints = buildSearchRecoveryHints({ query: 'uniqueauthorxyz', field: 'books' });
  assert.equal(hints.tip, 'try_authors');
  assert.ok(hints.alternateModes.some((m) => m.field === 'authors'));
});

test('opdsSearchAuthors matches listAuthors', () => {
  db.prepare(`
    INSERT OR REPLACE INTO authors (name, display_name, sort_name, search_name, book_count)
    VALUES ('садовников,георгий,михайлович', 'Садовников, Георгий Михайлович', 'садовников георгий михайлович', 'садовников георгий михайлович', 1)
  `).run();
  const listed = listAuthors({ query: 'Садовников', page: 1, pageSize: 10, sort: 'count' });
  const opds = opdsSearchAuthors('Садовников', { page: 1, pageSize: 10 });
  assert.equal(opds.total, listed.total);
  assert.deepEqual(
    opds.items.map((r) => r.name).sort(),
    listed.items.map((r) => r.name).sort()
  );
});
