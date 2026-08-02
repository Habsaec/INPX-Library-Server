/**
 * Search UX helpers: overview→drilldown warmup, result dedupe, ordered-title boost,
 * weak-result hints, typo query rewrite, series preference, FTS probe warmup.
 */
import { db, isBooksFtsUsable } from './db.js';
import { filterSearchContentTokens } from './search-normalize.js';

const WARM_TTL_MS = 60_000;
const WARM_MAX = 40;
/** @type {Map<string, { at: number, payload: any }>} */
const booksPageWarmCache = new Map();

function warmKey(query, sort = 'title') {
  return `${String(sort || 'title')}\n${String(query || '').trim().toLowerCase()}`;
}

export function rememberWarmSearchBooksPage(query, sort, payload) {
  const q = String(query || '').trim();
  if (!q || !payload) return;
  const key = warmKey(q, sort);
  booksPageWarmCache.set(key, { at: Date.now(), payload });
  if (booksPageWarmCache.size > WARM_MAX) {
    const oldest = booksPageWarmCache.keys().next().value;
    if (oldest !== undefined) booksPageWarmCache.delete(oldest);
  }
}

/**
 * Reuse first books page warmed by searchOverview (default sort=title, no filters).
 * @returns {any|null}
 */
export function takeWarmSearchBooksPage(query, {
  sort = 'title',
  page = 1,
  pageSize = 24,
  genre = '',
  letter = '',
  lang = '',
  format = '',
  year = 0,
  minRate = 0,
  hasSeries = null
} = {}) {
  if (page !== 1 || String(sort || 'title') !== 'title') return null;
  if (genre || letter || lang || format || year || Math.floor(Number(minRate) || 0) >= 1) return null;
  if (hasSeries === 0 || hasSeries === 1) return null;
  if (Number(pageSize) !== 24) return null;
  const key = warmKey(query, 'title');
  const hit = booksPageWarmCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > WARM_TTL_MS) {
    booksPageWarmCache.delete(key);
    return null;
  }
  /* Keep for a short window — second click / API twin may reuse. */
  return hit.payload;
}

export function clearWarmSearchBooksPages() {
  booksPageWarmCache.clear();
}

/**
 * Dedupe near-identical editions on a result page (title+first author).
 * Keeps higher libRate, then prefers non-empty archiveName stability by id.
 */
export function dedupeSearchBookItems(items = []) {
  if (!Array.isArray(items) || items.length <= 1) return items || [];
  const best = new Map();
  const order = [];
  for (const item of items) {
    if (!item?.id) continue;
    const titleKey = String(item.title || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
      .trim();
    const authorRaw = String(item.authors || '').split(/[:;]/)[0] || '';
    const authorKey = authorRaw
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const key = `${titleKey}|${authorKey}`;
    if (!best.has(key)) {
      best.set(key, item);
      order.push(key);
      continue;
    }
    const prev = best.get(key);
    const prevRate = Number(prev.libRate) || 0;
    const nextRate = Number(item.libRate) || 0;
    if (nextRate > prevRate) best.set(key, item);
    else if (nextRate === prevRate && String(item.id) < String(prev.id)) best.set(key, item);
  }
  return order.map((k) => best.get(k)).filter(Boolean);
}

/** Ordered contains pattern for title_search ranking (`%a%b%c%`). */
export function buildOrderedTitleLikePattern(tokens = []) {
  const parts = (Array.isArray(tokens) ? tokens : [])
    .map((tok) => String(tok || '').trim().toLowerCase())
    .filter((tok) => tok.length >= 3);
  if (parts.length < 2) return '';
  return `%${parts.join('%')}%`;
}

/**
 * True when page-1 hits already look like a confident title match.
 */
export function hasStrongTitleHit(items = [], query = '') {
  const needle = String(query || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
  if (!needle || !Array.isArray(items) || !items.length) return false;
  const first = items[0];
  const title = String(first?.title || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) return false;
  if (title === needle) return true;
  if (title.startsWith(needle)) return true;
  /* All content-ish tokens from query appear in title in order. */
  const tokens = needle.split(/\s+/).filter((t) => t.length >= 3);
  if (tokens.length >= 2) {
    let from = 0;
    let ok = true;
    for (const tok of tokens) {
      const idx = title.indexOf(tok, from);
      if (idx < 0) {
        ok = false;
        break;
      }
      from = idx + tok.length;
    }
    if (ok) return true;
  }
  return false;
}

/** Weak catalog page: few hits and none look like the typed title. */
export function isWeakBookSearchResult({ total = 0, items = [], query = '' } = {}) {
  const q = String(query || '').trim();
  if (!q) return false;
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (n <= 0) return true;
  if (n > 5) return false;
  return !hasStrongTitleHit(items, q);
}

/**
 * Rewrite one mistyped token using a did-you-mean hit.
 * @param {string} query
 * @param {{ query?: string, label?: string, type?: string }} suggestion
 */
export function applyDidYouMeanToQuery(query = '', suggestion = null) {
  const q = String(query || '').trim();
  const fix = String(suggestion?.query || suggestion?.label || '').trim();
  if (!q || !fix) return '';
  const qTokens = q.split(/\s+/).filter(Boolean);
  const fixKey = fix.toLowerCase().replace(/ё/g, 'е');
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < qTokens.length; i += 1) {
    const tok = qTokens[i].toLowerCase().replace(/ё/g, 'е');
    if (tok.length < 4) continue;
    const dist = levenshteinLite(tok, fixKey.split(/\s+/)[0] || fixKey);
    if (dist > 0 && dist <= 2 && dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) {
    /* Single-token suggestion replacing whole query when query is one token. */
    if (qTokens.length === 1 && fixKey.split(/\s+/).length === 1) return fix;
    return '';
  }
  const next = [...qTokens];
  next[bestIdx] = fix.includes(' ') ? fix.split(/\s+/)[0] : fix;
  return next.join(' ');
}

function levenshteinLite(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const row = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) row[j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const cur = row[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = cur;
    }
  }
  return row[t.length];
}

/**
 * Prefer series drilldown when query closely matches a series name.
 */
export function detectPreferredSearchField({
  query = '',
  booksTotal = 0,
  authorsTotal = 0,
  seriesTotal = 0,
  seriesSamples = []
} = {}) {
  const q = String(query || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
  if (!q || seriesTotal <= 0) return null;
  for (const row of seriesSamples || []) {
    const name = String(row.displayName || row.name || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) continue;
    if (name === q || name.startsWith(q) || q.startsWith(name)) {
      if (seriesTotal >= booksTotal || seriesTotal >= 1) return 'series';
    }
  }
  if (seriesTotal > 0 && booksTotal === 0 && authorsTotal === 0) return 'series';
  if (seriesTotal > booksTotal && seriesTotal >= authorsTotal) return 'series';
  return null;
}

/**
 * Decide whether Enter can skip the 3-row hub.
 * Conservative: return null when ambiguous.
 * @returns {'books'|'authors'|'series'|null}
 */
export function resolveSearchRouteField({
  query = '',
  booksTotal = 0,
  authorsTotal = 0,
  seriesTotal = 0,
  preferredField = null
} = {}) {
  const books = Math.max(0, Math.floor(Number(booksTotal) || 0));
  const authors = Math.max(0, Math.floor(Number(authorsTotal) || 0));
  const series = Math.max(0, Math.floor(Number(seriesTotal) || 0));
  if (!books && !authors && !series) return null;

  if (preferredField === 'series' && series > 0) return 'series';
  if (series > 0 && books === 0 && authors === 0) return 'series';

  const tokens = String(query || '').trim().split(/\s+/).filter(Boolean);
  const content = filterSearchContentTokens(
    tokens.map((tok) => tok.toLowerCase().replace(/ё/g, 'е'))
  );

  if (books >= 1 && authors === 0 && series === 0) return 'books';
  if (books >= 1 && content.length >= 2 && books > authors && books > series) return 'books';

  if (
    authors >= 1
    && tokens.length >= 1
    && tokens.length <= 3
    && authors > books
    && authors >= series
    && !(content.length >= 2 && books >= 1)
  ) {
    return 'authors';
  }

  return null;
}

/** Cheap FTS probes so first user MATCH is less cold after rebuild/index. */
export function warmupSearchFts(probes = ['а', 'the', 'книга']) {
  if (!isBooksFtsUsable()) return { ok: false, reason: 'fts_unusable' };
  let ran = 0;
  for (const raw of probes) {
    const token = String(raw || '').trim();
    if (!token) continue;
    try {
      const safe = token.replace(/"/g, '');
      db.prepare('SELECT 1 AS ok FROM books_fts WHERE books_fts MATCH ? LIMIT 1').get(`"${safe}"*`);
      ran += 1;
    } catch {
      /* ignore probe errors */
    }
  }
  return { ok: true, probes: ran };
}
