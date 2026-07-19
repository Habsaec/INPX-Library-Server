import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const { initDb, db } = await import('../src/db.js');
const { listAuthors } = await import('../src/inpx.js');

before(() => {
  initDb();
  db.exec('DELETE FROM book_authors');
  db.exec('DELETE FROM authors');
  const insert = db.prepare(`
    INSERT INTO authors (name, display_name, sort_name, search_name, book_count)
    VALUES (?, ?, ?, ?, ?)
  `);
  insert.run('роулинг,джоан,к.', 'Роулинг, Дж. К.', 'роулинг джоан к', 'роулинг джоан к', 5);
  insert.run('роулинг,джоан', 'Роулинг, Джоан', 'роулинг джоан', 'роулинг джоан', 3);
});

test('listAuthors finds all Rowling variants for initials query', () => {
  const result = listAuthors({ query: 'Дж. К. Роулинг', page: 1, pageSize: 24, sort: 'count' });
  const names = result.items.map((row) => row.name);
  assert.ok(names.includes('роулинг,джоан,к.'));
  assert.ok(names.includes('роулинг,джоан'));
  assert.equal(result.total, 2);
});
