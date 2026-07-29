import Database from 'better-sqlite3';

const db = new Database('data/library.db', { readonly: true, fileMustExist: true });

const meta = db
  .prepare("SELECT key, value FROM meta WHERE key LIKE '%fts%' OR key LIKE '%FTS%' OR key LIKE '%dirty%'")
  .all();
console.log('meta', meta);

try {
  console.log('books_fts count', db.prepare('SELECT COUNT(*) AS c FROM books_fts').get());
} catch (e) {
  console.log('books_fts err', e.message);
}

try {
  console.log(
    'title like',
    db.prepare("SELECT COUNT(*) AS c FROM books_fts WHERE title_search LIKE '%войн%'").get(),
  );
} catch (e) {
  console.log('like err', e.message);
}

for (const q of ['"война"*', 'война*', 'война', '"война"', 'title_search:"война"*']) {
  try {
    const row = db.prepare('SELECT COUNT(*) AS c FROM books_fts WHERE books_fts MATCH ?').get(q);
    console.log('MATCH', q, row);
  } catch (e) {
    console.log('MATCH err', q, e.message);
  }
}

console.log('active_books', db.prepare('SELECT COUNT(*) AS c FROM active_books').get());

try {
  const sample = db
    .prepare("SELECT id, title_search FROM books_fts WHERE title_search LIKE '%лесной%' LIMIT 5")
    .all();
  console.log('sample', sample);
} catch (e) {
  console.log('sample err', e.message);
}
