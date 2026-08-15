/**
 * Token-bucket per-IP rate limiter для просмотра каталога / API.
 * Защищает от спам-запросов поиском и каталогом, которые блокируют event loop.
 *
 * Обложки и портреты не считаются — иначе сетка книг + live-поиск Android
 * легко упираются в 429 при нормальном использовании.
 */
import { getClientKey } from '../services/rate-limiter.js';
import {
  BROWSE_WINDOW_MS,
  BROWSE_MAX_HITS_DEFAULT,
  BROWSE_MAX_HITS_AUTH_DEFAULT,
  BROWSE_MAX_TRACKED,
  BROWSE_PRUNE_INTERVAL_MS
} from '../constants.js';

const envLimit = Number(process.env.BROWSE_RATE_LIMIT);
const envAuthLimit = Number(process.env.BROWSE_RATE_LIMIT_AUTH);
const BROWSE_MAX_HITS = Number.isFinite(envLimit) && envLimit > 0 ? Math.floor(envLimit) : BROWSE_MAX_HITS_DEFAULT;
const BROWSE_MAX_HITS_AUTH = Number.isFinite(envAuthLimit) && envAuthLimit > 0
  ? Math.floor(envAuthLimit)
  : BROWSE_MAX_HITS_AUTH_DEFAULT;
const STALE_RECORD_MS = BROWSE_WINDOW_MS * 2;

const hits = new Map(); // ip -> { tokens: number, lastRefillAt: number, lastSeenAt: number, maxHits: number }

const EXEMPT_PATHS = new Set(['/health', '/health/perf', '/ready', '/api/index-status']);

function isExemptPath(pathname = '') {
  const path = String(pathname || '');
  if (EXEMPT_PATHS.has(path)) return true;
  if (path === '/api/authors/portrait') return true;
  // /api/books/:id/cover|cover-thumb and b64 variants
  if (path.endsWith('/cover') || path.endsWith('/cover-thumb')) return true;
  return false;
}

function isAuthenticatedRequest(req) {
  const auth = req.get?.('authorization') || req.headers?.authorization || '';
  return Boolean(String(auth).trim());
}

function maxHitsFor(req) {
  return isAuthenticatedRequest(req) ? BROWSE_MAX_HITS_AUTH : BROWSE_MAX_HITS;
}

function pruneOldHits() {
  const now = Date.now();
  for (const [key, record] of hits) {
    if (now - record.lastSeenAt > STALE_RECORD_MS) hits.delete(key);
  }
}

function refillTokens(record, now, maxHits) {
  const elapsedMs = Math.max(0, now - record.lastRefillAt);
  if (elapsedMs <= 0) return;
  const rate = maxHits / BROWSE_WINDOW_MS;
  record.tokens = Math.min(maxHits, record.tokens + elapsedMs * rate);
  record.lastRefillAt = now;
  record.maxHits = maxHits;
}

// Чистка каждые 2 минуты
setInterval(pruneOldHits, BROWSE_PRUNE_INTERVAL_MS).unref();

export function browseLimiter(req, res, next) {
  if (isExemptPath(req.path)) return next();
  const key = getClientKey(req);
  const now = Date.now();
  const maxHits = maxHitsFor(req);

  let record = hits.get(key);
  if (!record) {
    if (hits.size >= BROWSE_MAX_TRACKED) pruneOldHits();
    if (hits.size >= BROWSE_MAX_TRACKED) {
      const oldest = hits.keys().next().value;
      if (oldest !== undefined) hits.delete(oldest);
    }
    record = { tokens: maxHits, lastRefillAt: now, lastSeenAt: now, maxHits };
    hits.set(key, record);
  }

  refillTokens(record, now, maxHits);
  record.lastSeenAt = now;

  if (record.tokens < 1) {
    const rate = maxHits / BROWSE_WINDOW_MS;
    const retryAfterSec = Math.max(1, Math.ceil((1 - record.tokens) / rate / 1000));
    res.set('Retry-After', String(retryAfterSec));
    return res.status(429).json({ error: 'Слишком много запросов. Попробуйте через минуту.' });
  }
  record.tokens -= 1;
  next();
}
