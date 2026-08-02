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

test('detectPreferredSearchField boosts close series match', () => {
  assert.equal(detectPreferredSearchField({
    query: 'Гарри Поттер',
    booksTotal: 2,
    authorsTotal: 0,
    seriesTotal: 1,
    seriesSamples: [{ name: 'гарри поттер', displayName: 'Гарри Поттер' }]
  }), 'series');
});

test('resolveSearchRouteField: books-only and title-like go to books', () => {
  assert.equal(resolveSearchRouteField({
    query: 'пешком над облаками',
    booksTotal: 1,
    authorsTotal: 0,
    seriesTotal: 0
  }), 'books');
  assert.equal(resolveSearchRouteField({
    query: 'пешком над облаками',
    booksTotal: 5,
    authorsTotal: 1,
    seriesTotal: 0
  }), 'books');
});

test('resolveSearchRouteField: series preferred and author-like', () => {
  assert.equal(resolveSearchRouteField({
    query: 'Гарри Поттер',
    booksTotal: 2,
    authorsTotal: 0,
    seriesTotal: 1,
    preferredField: 'series'
  }), 'series');
  assert.equal(resolveSearchRouteField({
    query: 'Садовников',
    booksTotal: 0,
    authorsTotal: 3,
    seriesTotal: 0
  }), 'authors');
});

test('resolveSearchRouteField: mixed stays on hub', () => {
  assert.equal(resolveSearchRouteField({
    query: 'ник',
    booksTotal: 10,
    authorsTotal: 8,
    seriesTotal: 4
  }), null);
});
