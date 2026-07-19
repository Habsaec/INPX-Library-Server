/** Verify admin.js imports refreshBgThemePaletteFromFile (regression for ReferenceError). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const adminPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes', 'admin.js');

test('admin.js imports refreshBgThemePaletteFromFile', () => {
  const src = readFileSync(adminPath, 'utf8');
  assert.ok(src.includes('refreshBgThemePaletteFromFile'), 'admin.js must import and use refreshBgThemePaletteFromFile');
  assert.ok(
    /refreshBgThemePaletteFromFile,?\s*\n/.test(src) || src.includes('refreshBgThemePaletteForAdmin, refreshBgThemePaletteFromFile'),
    'refreshBgThemePaletteFromFile must be in import block'
  );
});
