/**
 * Preload for npm test: force an isolated DATA_DIR so tests never touch data/library.db.
 *
 * Usage: node --import <fileURL to this file> --test test/*.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = path.join(os.tmpdir(), `inpx-test-${process.pid}`);
}

process.env.INPX_TEST_RUN = '1';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

if (!process.env.INPX_TEST_ROOT) {
  process.env.INPX_TEST_ROOT = rootDir;
}
