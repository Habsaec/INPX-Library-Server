import { test } from 'node:test';
import assert from 'node:assert';
import { resolveIndexImportMode } from '../src/index-import-mode.js';

test('full index always uses bulk FTS and fast sqlite', () => {
  const mode = resolveIndexImportMode({ incremental: false, toProcess: 100, total: 100 });
  assert.strictEqual(mode.ftsBulkMode, true);
  assert.strictEqual(mode.useFastSqlite, true);
  assert.strictEqual(mode.incrementalBulk, false);
});

test('incremental with no work is idle', () => {
  const mode = resolveIndexImportMode({ incremental: true, toProcess: 0, total: 500 });
  assert.strictEqual(mode.ftsBulkMode, false);
  assert.strictEqual(mode.useFastSqlite, false);
});

test('small incremental keeps per-row FTS', () => {
  const mode = resolveIndexImportMode({ incremental: true, toProcess: 1, total: 500 });
  assert.strictEqual(mode.ftsBulkMode, false);
  assert.strictEqual(mode.useFastSqlite, true);
});

test('large incremental switches to bulk FTS', () => {
  const mode = resolveIndexImportMode({ incremental: true, toProcess: 60, total: 500 });
  assert.strictEqual(mode.ftsBulkMode, true);
  assert.strictEqual(mode.incrementalBulk, true);
  assert.strictEqual(mode.useFastSqlite, true);
});

test('incremental at ratio threshold uses bulk', () => {
  const mode = resolveIndexImportMode({ incremental: true, toProcess: 12, total: 100 });
  assert.strictEqual(mode.ftsBulkMode, true);
});

test('incremental with unknown total does not assume full bulk ratio', () => {
  const mode = resolveIndexImportMode({ incremental: true, toProcess: 50, total: 0 });
  assert.strictEqual(mode.ftsBulkMode, false);
  assert.strictEqual(mode.incrementalBulk, false);
});
