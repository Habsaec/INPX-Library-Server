import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, db } from '../src/db.js';
import { getRecentArrivals, searchCatalog } from '../src/inpx.js';

const OLD_ID = 'recent-arrivals-old';
const NEW_ID = 'recent-arrivals-new';
const MID_ID = 'recent-arrivals-mid';

before(() => {
  initDb();
  db.exec(`DELETE FROM books WHERE id IN ('${OLD_ID}', '${NEW_ID}', '${MID_ID}')`);
  db.exec(`DELETE FROM sources WHERE id = 9101`);
  db.prepare(`
    INSERT INTO sources (id, name, type, path, enabled)
    VALUES (9101, 'recent-test', 'folder', '/', 1)
  `).run();

  const insert = db.prepare(`
    INSERT INTO books (
      id, title, authors, genres, series, series_no, title_sort, author_sort,
      series_sort, series_index, title_search, authors_search, series_search,
      genres_search, keywords_search, file_name, archive_name, size, lib_id, deleted,
      ext, date, lang, keywords, lib_rate, source_id, imported_at
    ) VALUES (
      ?, ?, 'Test Author', '', '', '', ?, 'test author',
      '', 0, ?, 'test author', '',
      '', '', ?, '', 1, ?, 0,
      'fb2', ?, 'ru', '', 0, 9101, ?
    )
  `);

  // Catalog dates: newest = 2099-06-15 → window starts 2099-05-16
  insert.run(
    OLD_ID, 'Old Catalog Date', 'old catalog', 'old catalog', `${OLD_ID}.fb2`, OLD_ID,
    '2099-01-01', '2099-06-15 12:00:00'
  );
  insert.run(
    MID_ID, 'Mid Catalog Date', 'mid catalog', 'mid catalog', `${MID_ID}.fb2`, MID_ID,
    '2099-05-20', '2099-06-15 12:00:00'
  );
  insert.run(
    NEW_ID, 'New Catalog Date', 'new catalog', 'new catalog', `${NEW_ID}.fb2`, NEW_ID,
    '2099-06-15', '2099-06-15 12:00:00'
  );
});

test('searchCatalog without filters returns books (catalog not empty)', () => {
  const result = searchCatalog({ query: '', field: 'books', page: 1, pageSize: 24, sort: 'title' });
  assert.ok(result.total > 0);
  assert.ok(Array.isArray(result.items));
  assert.ok(result.items.length > 0);
});

test('getRecentArrivals uses INPX catalog date window, not bulk imported_at', () => {
  const result = getRecentArrivals({ page: 1, pageSize: 50, sort: 'recent' });
  assert.ok(result.total > 0);
  const ids = result.items.map((b) => b.id);
  assert.ok(ids.includes(NEW_ID));
  assert.ok(ids.includes(MID_ID));
  assert.ok(!ids.includes(OLD_ID), 'books older than 30 days before newest catalog date are excluded');
  assert.equal(ids[0], NEW_ID);
});
