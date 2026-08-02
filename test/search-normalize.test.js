import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterSearchContentTokens,
  normalizeLookalikeToken,
  normalizeLookalikeSortKey
} from '../src/search-normalize.js';
import { appendStemmedSearchTokens } from '../src/search-stem.js';

test('lookalike fixes mixed Latin/Cyrillic tokens only', () => {
  assert.equal(normalizeLookalikeToken('cадовников'), 'садовников');
  assert.equal(normalizeLookalikeToken('sadovnikov'), 'sadovnikov');
  assert.equal(normalizeLookalikeToken('садовников'), 'садовников');
});

test('lookalike sort-key maps mixed tokens', () => {
  assert.equal(normalizeLookalikeSortKey('cадовников пешком'), 'садовников пешком');
});

test('filterSearchContentTokens drops Russian stopwords', () => {
  assert.deepEqual(
    filterSearchContentTokens(['девочка', 'с', 'которой', 'ничего', 'не', 'случится']),
    ['девочка', 'которой', 'ничего', 'случится']
  );
  assert.deepEqual(filterSearchContentTokens(['с', 'не', 'и']), ['не']);
});

test('appendStemmedSearchTokens adds stem after base key', () => {
  const out = appendStemmedSearchTokens('пешком над облаками');
  assert.ok(out.startsWith('пешком над облаками'));
  assert.ok(out.includes('облак'));
});
