import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDidYouMeanToQuery,
  buildOrderedTitleLikePattern,
  dedupeSearchBookItems,
  detectPreferredSearchField,
  hasStrongTitleHit,
  isWeakBookSearchResult,
  resolveSearchRouteField
} from '../src/search-enhance.js';

test('buildOrderedTitleLikePattern joins content tokens', () => {
  assert.equal(
    buildOrderedTitleLikePattern(['пешком', 'над', 'облаками']),
    '%пешком%над%облаками%'
  );
  assert.equal(buildOrderedTitleLikePattern(['а']), '');
});

test('dedupeSearchBookItems keeps higher rating edition', () => {
  const items = dedupeSearchBookItems([
    { id: 'a', title: 'Пешком над облаками', authors: 'Садовников', libRate: 3 },
    { id: 'b', title: 'Пешком над облаками', authors: 'Садовников', libRate: 5 },
    { id: 'c', title: 'Другая', authors: 'Садовников', libRate: 1 }
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'b');
  assert.equal(items[1].id, 'c');
});

test('weak/strong title hit helpers', () => {
  assert.equal(hasStrongTitleHit([{ title: 'Пешком над облаками' }], 'пешком над облаками'), true);
  assert.equal(isWeakBookSearchResult({
    total: 2,
    items: [{ title: 'Совершенно другое' }],
    query: 'пешком над облаками'
  }), true);
  assert.equal(isWeakBookSearchResult({
    total: 1,
    items: [{ title: 'Пешком над облаками' }],
    query: 'пешком над облаками'
  }), false);
});

test('applyDidYouMeanToQuery rewrites mistyped token', () => {
  assert.equal(
    applyDidYouMeanToQuery('пешком над облакаии', { query: 'облаками', type: 'title' }),
    'пешком над облаками'
  );
});

test('detectPreferredSearchField: series only without authors', () => {
  assert.equal(detectPreferredSearchField({
    query: 'Гарри Поттер',
    booksTotal: 2,
    authorsTotal: 0,
    seriesTotal: 1,
    seriesSamples: [{ name: 'гарри поттер', displayName: 'Гарри Поттер' }]
  }), 'series');
});

test('detectPreferredSearchField: author surname never prefers series', () => {
  assert.equal(detectPreferredSearchField({
    query: 'Лукьяненко',
    booksTotal: 200,
    authorsTotal: 1,
    seriesTotal: 3,
    seriesSamples: [{ name: 'лукьяненко', displayName: 'Лукьяненко' }]
  }), null);
  assert.equal(detectPreferredSearchField({
    query: 'Садовников',
    booksTotal: 10,
    authorsTotal: 1,
    seriesTotal: 2,
    seriesSamples: [{ name: 'садовников', displayName: 'Садовников' }]
  }), null);
});

test('resolveSearchRouteField always null (Enter opens books)', () => {
  assert.equal(resolveSearchRouteField({
    query: 'пешком над облаками',
    booksTotal: 1,
    authorsTotal: 0,
    seriesTotal: 0
  }), null);
  assert.equal(resolveSearchRouteField({
    query: 'Гарри Поттер',
    booksTotal: 2,
    authorsTotal: 0,
    seriesTotal: 1,
    preferredField: 'series'
  }), null);
  assert.equal(resolveSearchRouteField({
    query: 'Садовников',
    booksTotal: 0,
    authorsTotal: 3,
    seriesTotal: 0
  }), null);
  assert.equal(resolveSearchRouteField({
    query: 'Лукьяненко',
    booksTotal: 200,
    authorsTotal: 1,
    seriesTotal: 5,
    preferredField: 'series'
  }), null);
});
