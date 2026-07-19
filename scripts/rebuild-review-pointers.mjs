/**
 * Одноразовое восстановление указателей отзывов после полной переиндексации.
 * Usage: runtime\node.exe scripts/rebuild-review-pointers.mjs [sourceId]
 */
import Database from 'better-sqlite3';
import { buildBookReviewPointersForSource } from '../src/flibusta-sidecar.js';
import { getSourceRoot } from '../src/inpx.js';
import { getSourceById } from '../src/db.js';

const sourceId = Number(process.argv[2] || 1);
const source = getSourceById(sourceId);
if (!source) {
  console.error('Source not found:', sourceId);
  process.exit(1);
}
const root = getSourceRoot(sourceId);
console.log(`Rebuilding review pointers for source ${sourceId} (${source.name})…`);
const t0 = Date.now();
await buildBookReviewPointersForSource(root, sourceId, (msg) => console.log(msg));
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const db = new Database('data/library.db', { readonly: true });
const cnt = db.prepare('SELECT COUNT(*) AS c FROM book_reviews WHERE review_shard IS NOT NULL').get().c;
console.log('Review pointers in DB:', cnt);
db.close();
