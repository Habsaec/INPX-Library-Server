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

test('listSeries finds series by name alone', () => {
  const result = listSeries({ query: 'Алиса', page: 1, pageSize: 24, sort: 'name' });
  const names = result.items.map((row) => row.name);
  assert.ok(names.includes(SERIES_NAME));
});

test('listSeries does not treat author-only query as all series by author', () => {
  const result = listSeries({ query: 'Кир Булычев', page: 1, pageSize: 24, sort: 'name' });
  const names = result.items.map((row) => row.name);
  assert.ok(!names.includes(SERIES_NAME), `author-only must not pull series by author, got ${JSON.stringify(names)}`);
});

test('listSeries finds series by author + series name query', () => {
  const result = listSeries({ query: 'Кир Булычев Алиса', page: 1, pageSize: 24, sort: 'name' });
  const names = result.items.map((row) => row.name);
  assert.ok(names.includes(SERIES_NAME), `expected ${SERIES_NAME} in ${JSON.stringify(names)}`);
});

test('listSeries supports surname + series name', () => {
  const result = listSeries({ query: 'Булычев Алиса', page: 1, pageSize: 24, sort: 'name' });
  const names = result.items.map((row) => row.name);
  assert.ok(names.includes(SERIES_NAME));
});

test('listSeries supports series name + surname (reversed order)', () => {
  const result = listSeries({ query: 'Алиса Булычев', page: 1, pageSize: 24, sort: 'name' });
  const names = result.items.map((row) => row.name);
  assert.ok(names.includes(SERIES_NAME), `expected ${SERIES_NAME} in ${JSON.stringify(names)}`);
});

test('listSeries supports series name + full author (reversed order)', () => {
  const result = listSeries({ query: 'Алиса Кир Булычев', page: 1, pageSize: 24, sort: 'name' });
  const names = result.items.map((row) => row.name);
  assert.ok(names.includes(SERIES_NAME), `expected ${SERIES_NAME} in ${JSON.stringify(names)}`);
});

test('listSeries surname-only matches series title, not author linkage', () => {
  const authorName = 'громов,александр';
  const seriesWithName = 'громов цикл';
  const seriesOther = 'чужой цикл';
  const books = [
    { id: 'gromov-named-1', series: seriesWithName, author: authorName },
    { id: 'gromov-other-1', series: seriesOther, author: authorName },
    { id: 'gromov-other-2', series: seriesOther, author: authorName }
  ];

  for (const book of books) {
    db.exec(`DELETE FROM book_series WHERE book_id = '${book.id}'`);
    db.exec(`DELETE FROM book_authors WHERE book_id = '${book.id}'`);
    db.exec(`DELETE FROM books WHERE id = '${book.id}'`);
  }
  db.exec(`DELETE FROM authors WHERE name = '${authorName}'`);
  db.exec(`DELETE FROM series_catalog WHERE name IN ('${seriesWithName}', '${seriesOther}')`);

  db.prepare(`
    INSERT INTO authors (name, display_name, sort_name, search_name, book_count)
    VALUES (?, 'Александр Громов', 'громов александр', 'громов александр', 3)
  `).run(authorName);

  db.prepare(`
    INSERT INTO series_catalog (name, display_name, sort_name, search_name, book_count)
    VALUES (?, 'Громов цикл', 'громов цикл', 'громов цикл', 1),
           (?, 'Чужой цикл', 'чужой цикл', 'чужой цикл', 2)
  `).run(seriesWithName, seriesOther);

  const insertBook = db.prepare(`
    INSERT INTO books (
      id, title, authors, genres, series, series_no, title_sort, author_sort,
      series_sort, series_index, title_search, authors_search, series_search,
      genres_search, keywords_search, file_name, archive_name, size, lib_id, deleted,
      ext, date, lang, keywords, lib_rate, source_id
    ) VALUES (
      ?, ?, 'Author', '', ?, '1',
      ?, 'author',
      ?, 1, ?, 'author', ?,
      '', '', ?, 'a.zip', 1, ?, 0,
      'fb2', '', 'ru', '', 0, 1
    )
  `);
  const linkAuthor = db.prepare('INSERT INTO book_authors (book_id, author_id) VALUES (?, ?)');
  const linkSeries = db.prepare('INSERT INTO book_series (book_id, series_id, series_no) VALUES (?, ?, ?)');
  const authorId = db.prepare('SELECT id FROM authors WHERE name = ?').get(authorName).id;
  const seriesIds = {
    [seriesWithName]: db.prepare('SELECT id FROM series_catalog WHERE name = ?').get(seriesWithName).id,
    [seriesOther]: db.prepare('SELECT id FROM series_catalog WHERE name = ?').get(seriesOther).id
  };

  for (const book of books) {
    insertBook.run(
      book.id, book.id, book.series,
      book.id, book.series, book.id, book.series,
      `${book.id}.fb2`, book.id
    );
    linkAuthor.run(book.id, authorId);
    linkSeries.run(book.id, seriesIds[book.series], '1');
  }

  const result = listSeries({ query: 'Громов', page: 1, pageSize: 50, sort: 'name' });
  const names = result.items.map((row) => row.name);
  assert.ok(names.includes(seriesWithName), `expected title match, got ${JSON.stringify(names)}`);
  assert.ok(!names.includes(seriesOther), `must not list author-linked series without name match, got ${JSON.stringify(names)}`);
});

test('listSeries finds series when series token is also a surname prefix (ник ясинский)', () => {
  const authorName = 'ясинский,андрей';
  const decoyAuthor = 'ник,иван';
  const seriesName = 'ник';
  const bookId = 'series-author-search-nik';

  db.exec(`DELETE FROM book_series WHERE book_id = '${bookId}'`);
  db.exec(`DELETE FROM book_authors WHERE book_id = '${bookId}'`);
  db.exec(`DELETE FROM books WHERE id = '${bookId}'`);
  db.exec(`DELETE FROM authors WHERE name IN ('${authorName}', '${decoyAuthor}')`);
  db.exec(`DELETE FROM series_catalog WHERE name = '${seriesName}'`);

  db.prepare(`
    INSERT INTO authors (name, display_name, sort_name, search_name, book_count)
    VALUES (?, 'Андрей Ясинский', 'ясинский андрей', 'ясинский андрей', 1),
           (?, 'Иван Ник', 'ник иван', 'ник иван', 1)
  `).run(authorName, decoyAuthor);

  db.prepare(`
    INSERT INTO series_catalog (name, display_name, sort_name, search_name, book_count)
    VALUES (?, 'Ник', 'ник', 'ник', 1)
  `).run(seriesName);

  db.prepare(`
    INSERT INTO books (
      id, title, authors, genres, series, series_no, title_sort, author_sort,
      series_sort, series_index, title_search, authors_search, series_search,
      genres_search, keywords_search, file_name, archive_name, size, lib_id, deleted,
      ext, date, lang, keywords, lib_rate, source_id
    ) VALUES (
      ?, 'Книга Ника', 'Андрей Ясинский', '', 'Ник', '1',
      'книга ника', 'ясинский андрей',
      'ник', 1, 'книга ника', 'ясинский андрей', 'ник',
      '', '', ?, 'a.zip', 1, ?, 0,
      'fb2', '', 'ru', '', 0, 1
    )
  `).run(bookId, `${bookId}.fb2`, bookId);

  const authorId = db.prepare('SELECT id FROM authors WHERE name = ?').get(authorName).id;
  const seriesId = db.prepare('SELECT id FROM series_catalog WHERE name = ?').get(seriesName).id;
  db.prepare('INSERT INTO book_authors (book_id, author_id) VALUES (?, ?)').run(bookId, authorId);
  db.prepare('INSERT INTO book_series (book_id, series_id, series_no) VALUES (?, ?, ?)').run(bookId, seriesId, '1');

  const forward = listSeries({ query: 'Ясинский Ник', page: 1, pageSize: 24, sort: 'name' });
  assert.ok(forward.items.some((row) => row.name === seriesName), `forward: ${JSON.stringify(forward.items)}`);

  const reversed = listSeries({ query: 'Ник Ясинский', page: 1, pageSize: 24, sort: 'name' });
  assert.ok(reversed.items.some((row) => row.name === seriesName), `reversed: ${JSON.stringify(reversed.items)}`);
});
