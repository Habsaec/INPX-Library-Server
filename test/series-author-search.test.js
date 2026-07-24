import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, db } from '../src/db.js';
import { listSeries } from '../src/inpx.js';

const AUTHOR_NAME = 'булычев,кир';
const SERIES_NAME = 'алиса';
const BOOK_ID = 'series-author-search-b1';

function seed() {
  db.exec('DELETE FROM book_series');
  db.exec('DELETE FROM book_authors');
  db.exec(`DELETE FROM books WHERE id = '${BOOK_ID}'`);
  db.exec(`DELETE FROM authors WHERE name = '${AUTHOR_NAME}'`);
  db.exec(`DELETE FROM series_catalog WHERE name = '${SERIES_NAME}'`);
  db.exec('DELETE FROM sources WHERE id = 1');

  db.prepare(`
    INSERT INTO sources (id, name, type, path, enabled)
    VALUES (1, 'test-src', 'folder', '/', 1)
  `).run();

  db.prepare(`
    INSERT INTO authors (name, display_name, sort_name, search_name, book_count)
    VALUES (?, 'Кир Булычев', 'булычев кир', 'булычев кир', 1)
  `).run(AUTHOR_NAME);

  db.prepare(`
    INSERT INTO series_catalog (name, display_name, sort_name, search_name, book_count)
    VALUES (?, 'Алиса', 'алиса', 'алиса', 1)
  `).run(SERIES_NAME);

  db.prepare(`
    INSERT INTO books (
      id, title, authors, genres, series, series_no, title_sort, author_sort,
      series_sort, series_index, title_search, authors_search, series_search,
      genres_search, keywords_search, file_name, archive_name, size, lib_id, deleted,
      ext, date, lang, keywords, lib_rate, source_id
    ) VALUES (
      ?, 'Девочка, с которой ничего не случится', 'Кир Булычев', '', 'Алиса', '1',
      'девочка с которой ничего не случится', 'булычев кир',
      'алиса', 1, 'девочка с которой ничего не случится', 'булычев кир', 'алиса',
      '', '', ?, 'a.zip', 1, ?, 0,
      'fb2', '', 'ru', '', 0, 1
    )
  `).run(BOOK_ID, `${BOOK_ID}.fb2`, BOOK_ID);

  const authorId = db.prepare('SELECT id FROM authors WHERE name = ?').get(AUTHOR_NAME).id;
  const seriesId = db.prepare('SELECT id FROM series_catalog WHERE name = ?').get(SERIES_NAME).id;
  db.prepare('INSERT INTO book_authors (book_id, author_id) VALUES (?, ?)').run(BOOK_ID, authorId);
  db.prepare('INSERT INTO book_series (book_id, series_id, series_no) VALUES (?, ?, ?)').run(BOOK_ID, seriesId, '1');
}

before(() => {
  initDb();
  seed();
});

test('listSeries finds series by author + series name query', () => {
  const result = listSeries({ query: 'Кир Булычев Алиса', page: 1, pageSize: 24, sort: 'name' });
  const names = result.items.map((row) => row.name);
  assert.ok(names.includes(SERIES_NAME), `expected ${SERIES_NAME} in ${JSON.stringify(names)}`);
  assert.ok(result.total >= 1);
});

test('listSeries still finds series by name alone', () => {
  const result = listSeries({ query: 'Алиса', page: 1, pageSize: 24, sort: 'name' });
  const names = result.items.map((row) => row.name);
  assert.ok(names.includes(SERIES_NAME));
});

test('listSeries still finds series by author name alone', () => {
  const result = listSeries({ query: 'Кир Булычев', page: 1, pageSize: 24, sort: 'name' });
  const names = result.items.map((row) => row.name);
  assert.ok(names.includes(SERIES_NAME), `expected ${SERIES_NAME} via author branch, got ${JSON.stringify(names)}`);
});

test('listSeries supports surname + series name', () => {
  const result = listSeries({ query: 'Булычев Алиса', page: 1, pageSize: 24, sort: 'name' });
  const names = result.items.map((row) => row.name);
  assert.ok(names.includes(SERIES_NAME));
});
