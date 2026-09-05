import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, db } from '../src/db.js';
import { getAuthorBooksGrouped, getBooksByFacet, listAuthors } from '../src/inpx.js';

function insertBook(id, title, authors) {
  db.prepare(`
    INSERT INTO books (
      id, title, authors, genres, series, series_no, title_sort, author_sort,
      series_sort, series_index, title_search, authors_search, series_search,
      genres_search, keywords_search, file_name, archive_name, size, lib_id, deleted,
      ext, date, lang, keywords, lib_rate, source_id
    ) VALUES (
      ?, ?, ?, '', '', '', ?, ?,
      '', 0, ?, ?, '', '', '', ?, 'a.zip', 1, ?, 0,
      'fb2', '', 'ru', '', 0, 1
    )
  `).run(id, title, authors, title.toLowerCase(), authors.toLowerCase(), title.toLowerCase(), authors.toLowerCase(), `${id}.fb2`, id);
}

test('INPX and folder author spellings share a page and one catalog card', () => {
  initDb();
  db.exec('DELETE FROM book_series');
  db.exec('DELETE FROM book_authors');
  db.exec('DELETE FROM books');
  db.exec('DELETE FROM authors');
  db.exec('DELETE FROM series_catalog');
  db.exec('DELETE FROM sources WHERE id = 1');

  db.prepare(`
    INSERT INTO sources (id, name, type, path, enabled)
    VALUES (1, 'test-src', 'folder', '/', 1)
  `).run();

  const search = 'ткачев андрей сергеевич';
  db.prepare(`
    INSERT INTO authors (name, display_name, sort_name, search_name, book_count)
    VALUES (?, ?, ?, ?, ?)
  `).run('ткачев,андрей сергеевич', 'Ткачев Андрей Сергеевич', search, search, 3);
  db.prepare(`
    INSERT INTO authors (name, display_name, sort_name, search_name, book_count)
    VALUES (?, ?, ?, ?, ?)
  `).run('ткачев андрей сергеевич', 'Ткачев Андрей Сергеевич', search, search, 2);

  const inpxId = db.prepare('SELECT id FROM authors WHERE name = ?').get('ткачев,андрей сергеевич').id;
  const folderId = db.prepare('SELECT id FROM authors WHERE name = ?').get('ткачев андрей сергеевич').id;
  insertBook('tk1', 'Book One', 'Ткачев Андрей Сергеевич');
  insertBook('tk2', 'Book Two', 'Ткачев Андрей Сергеевич');
  insertBook('tk3', 'Book Three', 'Ткачев Андрей Сергеевич');
  insertBook('tk4', 'Folder Four', 'Ткачев Андрей Сергеевич');
  insertBook('tk5', 'Folder Five', 'Ткачев Андрей Сергеевич');
  const link = db.prepare('INSERT INTO book_authors (book_id, author_id) VALUES (?, ?)');
  link.run('tk1', inpxId);
  link.run('tk2', inpxId);
  link.run('tk3', inpxId);
  link.run('tk4', folderId);
  link.run('tk5', folderId);

  const listed = listAuthors({ query: 'Ткачев Андрей', page: 1, pageSize: 24, sort: 'count' });
  assert.equal(listed.total, 1, 'catalog should show one author card');
  assert.equal(listed.items[0].name, 'ткачев,андрей сергеевич');
  assert.equal(listed.items[0].bookCount, 5);

  const fromInpx = getAuthorBooksGrouped('ткачев,андрей сергеевич', 'title', '');
  const fromFolder = getAuthorBooksGrouped('ткачев андрей сергеевич', 'title', '');
  assert.equal(fromInpx.total, 5);
  assert.equal(fromFolder.total, 5);
  const inpxIds = new Set(fromInpx.standaloneBooks.map((b) => b.id));
  const folderIds = new Set(fromFolder.standaloneBooks.map((b) => b.id));
  for (const id of ['tk1', 'tk2', 'tk3', 'tk4', 'tk5']) {
    assert.ok(inpxIds.has(id), `INPX alias page missing ${id}`);
    assert.ok(folderIds.has(id), `folder alias page missing ${id}`);
  }

  const facet = getBooksByFacet({ facet: 'authors', value: 'ткачев андрей сергеевич', page: 1, pageSize: 24, sort: 'title' });
  assert.equal(facet.total, 5);
  assert.equal(facet.items.length, 5);
});
