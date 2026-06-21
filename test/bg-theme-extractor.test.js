import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  extractThemeFromPixels,
  extractThemeFromImageBuffer,
} from '../src/services/bg-theme-extractor.js';
import { relativeLuminance, hexToRgb } from '../src/services/theme-engine.js';

test('extractThemeFromPixels builds darker and lighter surfaces from accent', () => {
  const samples = Array.from({ length: 64 }, () => ({ r: 190, g: 48, b: 28 }));
  const { darkSurface, lightSurface } = extractThemeFromPixels(samples);
  assert.notEqual(darkSurface, lightSurface);
  assert.ok(relativeLuminance(...hexToRgb(darkSurface)) < relativeLuminance(...hexToRgb(lightSurface)));
});

test('extractThemeFromImageBuffer samples uploaded image bytes', async () => {
  const buffer = await sharp({
    create: { width: 120, height: 80, channels: 3, background: { r: 24, g: 96, b: 140 } },
  }).webp().toBuffer();
  const palette = await extractThemeFromImageBuffer(buffer);
  assert.match(palette.darkSurface, /^#[0-9a-f]{6}$/);
  assert.match(palette.lightSurface, /^#[0-9a-f]{6}$/);
  assert.ok(relativeLuminance(...hexToRgb(palette.darkSurface)) < 0.25);
  assert.ok(relativeLuminance(...hexToRgb(palette.lightSurface)) > 0.7);
});
