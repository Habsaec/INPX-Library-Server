#!/usr/bin/env node
/** Integrity report for series links, duplicates, and junction consistency. */
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'library.db');

if (!fs.existsSync(dbPath)) {
  console.error('DB not found:', dbPath);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

const seriesBooks = db.prepare(`
  SELECT COUNT(*) AS c FROM active_books WHERE TRIM(COALESCE(series, '')) != ''
`).get().c;

const seriesLinkMatch = db.prepare(`
  SELECT COUNT(*) AS c FROM book_series bs
  JOIN series_catalog sc ON sc.id = bs.series_id
  JOIN active_books b ON b.id = bs.book_id
  WHERE TRIM(COALESCE(b.series, '')) != ''
    AND LOWER(TRIM(b.series)) = sc.name
`).get().c;

const seriesLinkContentMismatch = db.prepare(`
  SELECT COUNT(*) AS c FROM book_series bs
  JOIN series_catalog sc ON sc.id = bs.series_id
  JOIN active_books b ON b.id = bs.book_id
  WHERE TRIM(COALESCE(b.series, '')) != ''
    AND LOWER(TRIM(b.series)) != sc.name
`).get().c;

const totalBooks = db.prepare('SELECT COUNT(*) AS c FROM active_books').get().c;

const missingSeriesLink = db.prepare(`
  SELECT COUNT(*) AS c FROM active_books b
  WHERE TRIM(COALESCE(b.series, '')) != ''
    AND NOT EXISTS (SELECT 1 FROM book_series bs WHERE bs.book_id = b.id)
`).get().c;

const seriesLinkButEmptyField = db.prepare(`
  SELECT COUNT(*) AS c FROM book_series bs
  JOIN active_books b ON b.id = bs.book_id
  WHERE TRIM(COALESCE(b.series, '')) = ''
`).get().c;

const seriesNameMismatch = db.prepare(`
  SELECT COUNT(*) AS c FROM book_series bs
  JOIN series_catalog sc ON sc.id = bs.series_id
  JOIN active_books b ON b.id = bs.book_id
  WHERE TRIM(COALESCE(b.series, '')) != ''
    AND LOWER(TRIM(b.series)) != sc.name
`).get().c;

const dupGroups = db.prepare(`
  SELECT COUNT(*) AS c FROM (
    SELECT title_sort, COALESCE(authors, '') AS authors, COUNT(*) AS n
    FROM active_books
    WHERE title_sort IS NOT NULL AND title_sort != ''
    GROUP BY title_sort, authors
    HAVING n > 1
  )
`).get().c;

const dupBooks = db.prepare(`
  SELECT COALESCE(SUM(n), 0) AS c FROM (
    SELECT COUNT(*) AS n FROM active_books
    WHERE title_sort IS NOT NULL AND title_sort != ''
    GROUP BY title_sort, authors
    HAVING COUNT(*) > 1
  )
`).get().c;

const orphanJunctionAuthors = db.prepare(`
  SELECT COUNT(*) AS c FROM book_authors ba
  WHERE NOT EXISTS (SELECT 1 FROM active_books b WHERE b.id = ba.book_id)
`).get().c;

const orphanJunctionSeries = db.prepare(`
  SELECT COUNT(*) AS c FROM book_series bs
  WHERE NOT EXISTS (SELECT 1 FROM active_books b WHERE b.id = bs.book_id)
`).get().c;

const booksWithoutAuthors = db.prepare(`
  SELECT COUNT(*) AS c FROM active_books b
  WHERE TRIM(COALESCE(b.authors, '')) != ''
    AND NOT EXISTS (SELECT 1 FROM book_authors ba WHERE ba.book_id = b.id)
`).get().c;

const sampleMissingSeries = db.prepare(`
  SELECT b.id, b.title, b.series, b.archive_name AS archive
  FROM active_books b
  WHERE TRIM(COALESCE(b.series, '')) != ''
    AND NOT EXISTS (SELECT 1 FROM book_series bs WHERE bs.book_id = b.id)
  LIMIT 5
`).all();

const sampleSeriesMismatch = db.prepare(`
  SELECT b.id, b.title, b.series AS bookSeries, sc.name AS catalogName, sc.display_name AS displayName
  FROM book_series bs
  JOIN series_catalog sc ON sc.id = bs.series_id
  JOIN active_books b ON b.id = bs.book_id
  WHERE TRIM(COALESCE(b.series, '')) != ''
    AND LOWER(TRIM(b.series)) != sc.name
  LIMIT 5
`).all();

const report = {
  dbPath,
  totalBooks,
  seriesBooks,
  seriesLinkMatch,
  seriesLinkContentMismatch,
  missingSeriesLink,
  seriesLinkButEmptyField,
  seriesNameMismatch,
  dupGroups,
  dupBooks,
  orphanJunctionAuthors,
  orphanJunctionSeries,
  booksWithoutAuthors,
  sampleMissingSeries,
  sampleSeriesMismatch
};

console.log(JSON.stringify(report, null, 2));
db.close();
