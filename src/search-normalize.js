/**
 * Query-time lookalike normalization for mixed Latin/Cyrillic tokens.
 * Does not rewrite pure-Latin or pure-Cyrillic tokens.
 */

const LAT_TO_CYR = {
  a: 'а',
  e: 'е',
  o: 'о',
  p: 'р',
  c: 'с',
  x: 'х',
  y: 'у',
  k: 'к',
  h: 'н',
  b: 'в',
  m: 'м',
  t: 'т'
};

/**
 * @param {string} token lowercase token
 * @returns {string}
 */
export function normalizeLookalikeToken(token = '') {
  const t = String(token || '');
  if (!t) return t;
  const hasCyr = /[а-яё]/i.test(t);
  const hasLat = /[a-z]/i.test(t);
  if (!hasCyr || !hasLat) return t;
  return t.replace(/[a-z]/gi, (ch) => {
    const mapped = LAT_TO_CYR[ch.toLowerCase()];
    return mapped || ch;
  });
}

/**
 * Apply lookalike fix to an already-built sort-key string.
 * @param {string} sortKey
 * @returns {string}
 */
export function normalizeLookalikeSortKey(sortKey = '') {
  return String(sortKey || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeLookalikeToken)
    .join(' ');
}

/**
 * High-frequency Russian/function words that explode FTS posting lists and
 * LIKE `%token%` scans when ANDed into multi-word title queries
 * (e.g. «Девочка с которой ничего не случится»).
 */
const SEARCH_STOPWORDS = new Set([
  'а', 'и', 'в', 'во', 'на', 'не', 'ни', 'но', 'о', 'об', 'обо', 'от', 'до', 'из', 'за',
  'по', 'под', 'при', 'про', 'с', 'со', 'у', 'к', 'ко', 'для', 'без', 'над', 'между',
  'что', 'как', 'же', 'бы', 'ли', 'то', 'это', 'или', 'чем', 'уже', 'ещё', 'еще',
  'он', 'она', 'они', 'мы', 'вы', 'ты', 'его', 'ее', 'её', 'их', 'мне',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are'
]);

/**
 * Keep content tokens for AND/MATCH clauses. Full phrase matching should still
 * use the original token list so exact titles remain findable.
 * @param {string[]} tokens
 * @returns {string[]}
 */
export function filterSearchContentTokens(tokens = []) {
  const list = (Array.isArray(tokens) ? tokens : [])
    .map((tok) => String(tok || '').trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return [];
  const content = list.filter((tok) => tok.length >= 3 && !SEARCH_STOPWORDS.has(tok));
  if (content.length) return content;
  /* All stopwords / short: keep the longest original token(s). */
  const maxLen = Math.max(...list.map((tok) => tok.length));
  return list.filter((tok) => tok.length === maxLen);
}
