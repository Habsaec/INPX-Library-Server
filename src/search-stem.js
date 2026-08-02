/**
 * Lightweight Russian query expansion for FTS prefix MATCH.
 * Not a full morphological analyzer — strips common inflectional suffixes
 * so "облаками" can match indexed "облаками" via stem "облак"* .
 */

const RU_SUFFIXES = [
  'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими',
  'ах', 'ях', 'ов', 'ев', 'ём', 'ом', 'ем', 'ам', 'ям',
  'ой', 'ей', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие',
  'ую', 'юю', 'ии', 'ых', 'их', 'ым', 'им',
  'ы', 'и', 'а', 'я', 'у', 'ю', 'о', 'е', 'ь'
];

/**
 * @param {string} token lowercase sort-key token
 * @returns {string} stem (may equal token)
 */
export function stemRussianToken(token = '') {
  const t = String(token || '').toLowerCase();
  if (t.length < 4) return t;
  for (const suf of RU_SUFFIXES) {
    if (t.length - suf.length < 3) continue;
    if (t.endsWith(suf)) return t.slice(0, -suf.length);
  }
  return t;
}

/**
 * Expand each token to [original, stem?] for FTS OR-groups.
 * @param {string[]} tokens
 * @returns {string[][]}
 */
export function expandSearchTokenVariants(tokens = []) {
  return tokens.map((token) => {
    const t = String(token || '').trim();
    if (!t) return [];
    const variants = [t];
    if (t.length >= 4) {
      const stem = stemRussianToken(t);
      if (stem && stem !== t && stem.length >= 3) variants.push(stem);
    }
    return variants;
  }).filter((group) => group.length > 0);
}
