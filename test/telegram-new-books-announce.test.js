import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderNewBooksAnnounceMessage,
} from '../src/telegram-bot-defaults.js';

test('renderNewBooksAnnounceMessage substitutes placeholders', () => {
  const text = renderNewBooksAnnounceMessage(
    'Новых книг: {{count}}. {{url}} {{link}}',
    5,
    'https://books.example.com',
    (s) => String(s).replace(/&/g, '&amp;'),
  );
  assert.match(text, /Новых книг: 5/);
  assert.match(text, /https:\/\/books\.example\.com\/library\/recent/);
  assert.match(text, /<a href="https:\/\/books\.example\.com\/library\/recent">/);
});

test('renderNewBooksAnnounceMessage uses default template', () => {
  const text = renderNewBooksAnnounceMessage('', 3, 'https://lib.local');
  assert.match(text, /<b>3<\/b>/);
  assert.match(text, /Новинки/);
  assert.match(text, /lib\.local\/library\/recent/);
});

test('renderNewBooksAnnounceMessage fixes embedded {{https://...}} placeholder', () => {
  const text = renderNewBooksAnnounceMessage(
    'Ссылка: {{https://books.example.com/library/recent}}',
    2,
    '',
    (s) => String(s),
  );
  assert.match(text, /https:\/\/books\.example\.com\/library\/recent/);
  assert.doesNotMatch(text, /\{\{/);
});
