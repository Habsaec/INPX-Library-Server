import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGenreList, parseHasSeries } from '../src/inpx.js';

test('parseGenreList accepts CSV, arrays, and dedupes', () => {
  assert.deepEqual(parseGenreList('sf'), ['sf']);
  assert.deepEqual(parseGenreList('sf,det'), ['sf', 'det']);
  assert.deepEqual(parseGenreList(['sf', 'det,adv']), ['sf', 'det', 'adv']);
  assert.deepEqual(parseGenreList('sf, sf ,det'), ['sf', 'det']);
  assert.deepEqual(parseGenreList(''), []);
  assert.deepEqual(parseGenreList(['', '  ']), []);
});

test('parseGenreList trims and normalizes whitespace-only pieces', () => {
  assert.deepEqual(parseGenreList('sf, ,det'), ['sf', 'det']);
});

test('parseHasSeries accepts 1/0 and booleans, rejects names', () => {
  assert.equal(parseHasSeries('1'), 1);
  assert.equal(parseHasSeries(true), 1);
  assert.equal(parseHasSeries('0'), 0);
  assert.equal(parseHasSeries(false), 0);
  assert.equal(parseHasSeries(''), null);
  assert.equal(parseHasSeries('Harry Potter'), null);
});
