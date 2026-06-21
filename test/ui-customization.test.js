import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../src/config.js';

const uiDir = path.join(config.dataDir, 'ui');

const {
  getUiCustomization,
  getThemeCssVars,
  hasUiThemeConfigured,
  hasUiThemeColorsConfigured,
  hasUiThemeSlidersConfigured,
  hasUiBackgroundSlidersConfigured,
  hasUiPanelSlidersConfigured,
  hasUiThemeTypographyConfigured,
  resetUiThemeColors,
  resetUiThemeSliders,
  saveUiSettings,
  saveUiTypographySettings,
  saveUiFontFile,
  resetUiThemeTypography,
  saveUiAsset,
  removeUiAsset,
  invalidateUiCustomizationCache,
  getPublicUiSettingsJson,
  refreshBgThemePaletteFromFile,
  normalizeHexColor,
  deriveGlassTheme,
  DEFAULT_GLASS_DARK,
  DEFAULT_GLASS_LIGHT,
  LEGACY_SURFACE_DARK,
  LEGACY_SURFACE_LIGHT,
} = await import('../src/services/ui-customization.js');

const { initDb, setSetting, getSetting } = await import('../src/db.js');
initDb();

function resetUiDir() {
  fs.mkdirSync(uiDir, { recursive: true });
  for (const name of fs.readdirSync(uiDir)) {
    fs.unlinkSync(path.join(uiDir, name));
  }
}

before(() => resetUiDir());
after(() => resetUiDir());

function tinyPngBuffer() {
  return sharp({
    create: { width: 64, height: 32, channels: 3, background: { r: 200, g: 120, b: 40 } },
  }).png().toBuffer();
}

test('saveUiAsset stores logo and exposes cache-busted URL', async () => {
  invalidateUiCustomizationCache();
  await saveUiAsset('logo', await tinyPngBuffer());
  const ui = getUiCustomization();
  assert.ok(ui.hasLogo);
  assert.match(ui.logoUrl, /^\/custom\/ui\/logo\?v=\d+$/);
  assert.ok(fs.existsSync(path.join(uiDir, 'logo.png')));
});

test('normalizeHexColor expands short hex and rejects invalid values', () => {
  assert.equal(normalizeHexColor('#abc', '#000000'), '#aabbcc');
  assert.equal(normalizeHexColor('#AABBCC', '#000000'), '#aabbcc');
  assert.equal(normalizeHexColor('nope', '#123456'), '#123456');
});

test('deriveGlassTheme picks light text on dark glass and dark text on light glass', () => {
  const darkGlass = deriveGlassTheme('#141210');
  assert.equal(darkGlass.text, '#ece6dc');
  const lightGlass = deriveGlassTheme('#f7f4ef');
  assert.equal(lightGlass.text, '#2a2218');
});

test('getThemeCssVars applies theme palette without custom background', () => {
  invalidateUiCustomizationCache();
  setSetting('ui_glass_color_dark', '');
  setSetting('ui_glass_color_light', '');
  setSetting('ui_bg_blur', '');
  setSetting('ui_bg_overlay', '');
  setSetting('ui_surface_opacity', '');
  setSetting('ui_surface_blur', '');
  saveUiSettings({ glassColorLight: '#ffcc99' });
  assert.equal(hasUiThemeColorsConfigured(), true);
  const vars = getThemeCssVars();
  assert.ok(vars.some((v) => v.startsWith('--ui-theme-light-surface:#ffcc99')));
  assert.ok(!vars.some((v) => v.startsWith('--ui-surface-opacity:')));
  assert.ok(!vars.some((v) => v.startsWith('--ui-bg-image:')));
});

test('getThemeCssVars injects background vars without custom theme colors', () => {
  invalidateUiCustomizationCache();
  resetUiThemeColors();
  resetUiThemeSliders();
  const uiDir = path.join(config.dataDir, 'ui');
  fs.mkdirSync(uiDir, { recursive: true });
  fs.writeFileSync(path.join(uiDir, 'background.webp'), Buffer.from('RIFF    WEBPVP8 '));
  assert.equal(hasUiThemeColorsConfigured(), false);
  assert.equal(hasUiPanelSlidersConfigured(), false);
  const vars = getThemeCssVars();
  assert.ok(vars.some((v) => v.startsWith('--ui-bg-image:')));
  assert.ok(vars.some((v) => v.startsWith('--ui-theme-dark-bg-overlay-color:')));
  assert.ok(!vars.some((v) => v.startsWith('--ui-theme-dark-text:')));
  assert.ok(!vars.some((v) => v.startsWith('--ui-surface-opacity:')));
  try { fs.unlinkSync(path.join(uiDir, 'background.webp')); } catch { /* ignore */ }
});

test('background sliders do not enable panel glass vars', () => {
  invalidateUiCustomizationCache();
  resetUiThemeSliders();
  saveUiSettings({ bgBlur: 8, bgOverlay: 20 });
  assert.equal(hasUiBackgroundSlidersConfigured(), true);
  assert.equal(hasUiPanelSlidersConfigured(), false);
  const vars = getThemeCssVars();
  assert.ok(!vars.some((v) => v.startsWith('--ui-surface-opacity:')));
  assert.ok(!vars.some((v) => v.startsWith('--ui-surface-blur:')));
});

test('panel sliders inject surface vars without background image', () => {
  invalidateUiCustomizationCache();
  resetUiThemeSliders();
  saveUiSettings({ surfaceOpacity: 100, surfaceBlur: 6 });
  assert.equal(hasUiPanelSlidersConfigured(), true);
  assert.equal(hasUiBackgroundSlidersConfigured(), false);
  const vars = getThemeCssVars();
  assert.ok(vars.some((v) => v.startsWith('--ui-surface-opacity:100')));
  assert.ok(vars.some((v) => v.startsWith('--ui-surface-blur:6px')));
  assert.ok(!vars.some((v) => v.startsWith('--ui-bg-image:')));
});

test('resetUiThemeColors clears saved palette settings', () => {
  invalidateUiCustomizationCache();
  saveUiSettings({
    glassColorDark: '#222222',
    glassColorLight: '#eeeeee',
    glassTextAutoDark: false,
    glassTextDark: '#ffffff',
  });
  assert.equal(hasUiThemeColorsConfigured(), true);
  resetUiThemeColors();
  assert.equal(hasUiThemeColorsConfigured(), false);
  const ui = getUiCustomization();
  assert.equal(ui.glassColorDark, DEFAULT_GLASS_DARK);
  assert.equal(ui.glassColorLight, DEFAULT_GLASS_LIGHT);
  assert.equal(ui.glassTextAutoDark, true);
});

test('saveUiSettings with legacy colors does not enable custom theme palette', () => {
  invalidateUiCustomizationCache();
  saveUiSettings({ glassColorDark: LEGACY_SURFACE_DARK, glassColorLight: LEGACY_SURFACE_LIGHT });
  assert.equal(hasUiThemeColorsConfigured(), false);
  assert.equal(getThemeCssVars().some((v) => v.startsWith('--ui-theme-dark-surface:')), false);
});

test('resetUiThemeSliders clears saved slider settings', () => {
  invalidateUiCustomizationCache();
  saveUiSettings({ bgBlur: 12, bgOverlay: 55, surfaceOpacity: 72, surfaceBlur: 10 });
  assert.equal(hasUiThemeSlidersConfigured(), true);
  resetUiThemeSliders();
  assert.equal(hasUiThemeSlidersConfigured(), false);
  const ui = getUiCustomization();
  assert.equal(ui.blur, 0);
  assert.equal(ui.overlay, 0);
  assert.equal(ui.bgContrast, 80);
  assert.equal(ui.surfaceOpacity, 88);
  assert.equal(ui.surfaceBlur, 0);
});

test('saveUiSettings persists glass colors and text overrides', () => {
  invalidateUiCustomizationCache();
  saveUiSettings({
    glassColorDark: '#222222',
    glassColorLight: '#eeeeee',
    glassTextAutoDark: false,
    glassTextDark: '#ffffff',
    glassTextAutoLight: true,
    glassMutedAutoDark: false,
    glassMutedDark: '#aaaaaa',
    glassLinkAutoLight: false,
    glassLinkLight: '#336699',
  });
  const ui = getUiCustomization();
  assert.equal(ui.glassColorDark, '#222222');
  assert.equal(ui.glassColorLight, '#eeeeee');
  assert.equal(ui.glassTextDark, '#ffffff');
  assert.equal(ui.glassTextAutoDark, false);
  assert.equal(ui.glassTextAutoLight, true);
  assert.equal(ui.glassMutedDark, '#aaaaaa');
  assert.equal(ui.glassMutedAutoDark, false);
  assert.equal(ui.glassLinkLight, '#336699');
  assert.equal(ui.glassLinkAutoLight, false);
});

test('getUiCustomization uses defaults for glass colors', () => {
  invalidateUiCustomizationCache();
  setSetting('ui_glass_color_dark', '');
  setSetting('ui_glass_color_light', '');
  setSetting('ui_glass_text_dark', '');
  setSetting('ui_glass_text_light', '');
  invalidateUiCustomizationCache();
  const ui = getUiCustomization();
  assert.equal(ui.glassColorDark, DEFAULT_GLASS_DARK);
  assert.equal(ui.glassColorLight, DEFAULT_GLASS_LIGHT);
  assert.equal(ui.glassTextAutoDark, true);
  assert.equal(ui.glassTextAutoLight, true);
});

test('getPublicUiSettingsJson returns glass theme fields', () => {
  invalidateUiCustomizationCache();
  saveUiSettings({ glassColorDark: '#101010', glassTextAutoDark: true });
  const json = getPublicUiSettingsJson();
  assert.equal(json.glassColorDark, '#101010');
  assert.equal(typeof json.glassTextDark, 'string');
  assert.equal(json.glassTextAutoDark, true);
});

test('getThemeCssVars injects typography vars when font size or density is customized', () => {
  invalidateUiCustomizationCache();
  saveUiTypographySettings({ fontSize: 16, density: 'compact' });
  assert.equal(hasUiThemeTypographyConfigured(), true);
  const vars = getThemeCssVars();
  assert.ok(vars.some((v) => v.startsWith('--font-size-base:16px')));
  assert.ok(vars.some((v) => v.startsWith('--space-md:8px')));
});

test('saveUiTypographySettings clears font size at default', () => {
  invalidateUiCustomizationCache();
  resetUiThemeTypography();
  saveUiTypographySettings({ fontSize: 14 });
  assert.equal(getSetting('ui_font_size'), '');
  assert.equal(hasUiThemeTypographyConfigured(), false);
});

test('legacy ui_font_scale maps to font size on read', () => {
  invalidateUiCustomizationCache();
  resetUiThemeTypography();
  setSetting('ui_font_scale', 'large');
  invalidateUiCustomizationCache();
  assert.equal(getUiCustomization().fontSize, 16);
  assert.equal(hasUiThemeTypographyConfigured(), true);
});

test('saveUiTypographySettings persists font family preset', () => {
  invalidateUiCustomizationCache();
  resetUiThemeTypography();
  saveUiTypographySettings({ fontFamily: 'georgia' });
  assert.equal(getUiCustomization().fontFamily, 'georgia');
  const vars = getThemeCssVars();
  assert.ok(vars.some((v) => v.startsWith('--ui-font-family:') && v.includes('Georgia')));
});

test('saveUiTypographySettings custom requires uploaded font', () => {
  invalidateUiCustomizationCache();
  resetUiThemeTypography();
  assert.throws(() => saveUiTypographySettings({ fontFamily: 'custom' }), /errorFontRequired/);
});

test('saveUiFontFile stores font and selects custom preset', async () => {
  invalidateUiCustomizationCache();
  resetUiThemeTypography();
  await saveUiFontFile(Buffer.from('wOF2test-font-data'), 'My Font.woff2');
  const ui = getUiCustomization();
  assert.equal(ui.fontFamily, 'custom');
  assert.equal(ui.hasCustomFont, true);
  assert.ok(ui.customFontUrl);
  assert.equal(ui.customFontName, 'My Font');
});

test('removeUiAsset font clears custom font', async () => {
  invalidateUiCustomizationCache();
  resetUiThemeTypography();
  await saveUiFontFile(Buffer.from('wOF2x'), 'Test.woff2');
  removeUiAsset('font');
  const ui = getUiCustomization();
  assert.equal(ui.hasCustomFont, false);
  assert.equal(ui.fontFamily, 'inter');
});

test('saveUiSettings persists blur, bg contrast and login logo flag', () => {
  invalidateUiCustomizationCache();
  saveUiSettings({ bgBlur: 12, bgOverlay: 55, showLogoOnLogin: false });
  const ui = getUiCustomization();
  assert.equal(ui.blur, 12);
  assert.equal(ui.bgContrast, 55);
  assert.equal(ui.overlay, 25);
  assert.equal(ui.showLogoOnLogin, false);
});

test('saveUiSettings persists surface opacity', () => {
  invalidateUiCustomizationCache();
  saveUiSettings({ surfaceOpacity: 72 });
  const ui = getUiCustomization();
  assert.equal(ui.surfaceOpacity, 72);
});

test('saveUiSettings persists surface blur', () => {
  invalidateUiCustomizationCache();
  saveUiSettings({ surfaceBlur: 10 });
  const ui = getUiCustomization();
  assert.equal(ui.surfaceBlur, 10);
});

test('saveUiSettings keeps surface opacity at zero', () => {
  saveUiSettings({ surfaceOpacity: 0 });
  const ui = getUiCustomization();
  assert.equal(ui.surfaceOpacity, 0);
});

test('saveUiSettings keeps minimum bg contrast (max overlay tint)', () => {
  saveUiSettings({ bgOverlay: 0 });
  const ui = getUiCustomization();
  assert.equal(ui.bgContrast, 0);
  assert.equal(ui.overlay, 80);
});

test('removeUiAsset deletes custom logo', async () => {
  invalidateUiCustomizationCache();
  await saveUiAsset('logo', await tinyPngBuffer());
  removeUiAsset('logo');
  const ui = getUiCustomization();
  assert.equal(ui.hasLogo, false);
  assert.equal(ui.logoUrl, null);
});

test('getPublicUiSettingsJson returns serializable settings', () => {
  invalidateUiCustomizationCache();
  setSetting('ui_bg_blur', '4');
  invalidateUiCustomizationCache();
  const json = getPublicUiSettingsJson();
  assert.equal(typeof json.bgBlur, 'number');
  assert.equal(json.bgBlur, 4);
});

test('dynamic theme from background applies extracted palette', async () => {
  invalidateUiCustomizationCache();
  resetUiThemeColors();
  resetUiDir();
  fs.mkdirSync(uiDir, { recursive: true });
  const buffer = await sharp({
    create: { width: 96, height: 64, channels: 3, background: { r: 180, g: 60, b: 24 } },
  }).webp().toBuffer();
  fs.writeFileSync(path.join(uiDir, 'background.webp'), buffer);
  const palette = await refreshBgThemePaletteFromFile();
  saveUiSettings({ dynamicThemeFromBg: true });
  assert.equal(hasUiThemeColorsConfigured(), true);
  const ui = getUiCustomization();
  assert.equal(ui.dynamicThemeFromBg, true);
  assert.equal(ui.glassColorDark, palette.darkSurface);
  assert.equal(ui.glassColorLight, palette.lightSurface);
  assert.ok(getThemeCssVars().some((v) => v.startsWith(`--ui-theme-dark-surface:${palette.darkSurface}`)));
});

test('dynamic theme preserves manual text color overrides', async () => {
  invalidateUiCustomizationCache();
  resetUiThemeColors();
  resetUiDir();
  fs.mkdirSync(uiDir, { recursive: true });
  fs.writeFileSync(path.join(uiDir, 'background.webp'), await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#224466' },
  }).webp().toBuffer());
  await refreshBgThemePaletteFromFile();
  saveUiSettings({ dynamicThemeFromBg: true });
  saveUiSettings({
    glassTextAutoDark: false,
    glassTextDark: '#aabbcc',
    glassTextAutoLight: false,
    glassTextLight: '#112233',
  });
  const ui = getUiCustomization();
  assert.equal(ui.glassTextDark, '#aabbcc');
  assert.equal(ui.glassTextLight, '#112233');
  assert.equal(ui.glassTextAutoDark, false);
});

test('refresh from background resets manual text colors to auto', async () => {
  invalidateUiCustomizationCache();
  resetUiThemeColors();
  resetUiDir();
  fs.mkdirSync(uiDir, { recursive: true });
  fs.writeFileSync(path.join(uiDir, 'background.webp'), await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#663322' },
  }).webp().toBuffer());
  saveUiSettings({
    dynamicThemeFromBg: true,
    glassTextAutoDark: false,
    glassTextDark: '#ddeeff',
    glassMutedAutoDark: false,
    glassMutedDark: '#aabbcc',
  });
  await refreshBgThemePaletteFromFile({ resetTypography: true });
  const ui = getUiCustomization();
  assert.equal(getSetting('ui_glass_text_dark'), '');
  assert.equal(getSetting('ui_glass_muted_dark'), '');
  assert.equal(ui.glassTextAutoDark, true);
  assert.notEqual(ui.glassTextDark, '#ddeeff');
});

test('background palette refresh without reset keeps manual text overrides', async () => {
  invalidateUiCustomizationCache();
  resetUiThemeColors();
  resetUiDir();
  fs.mkdirSync(uiDir, { recursive: true });
  fs.writeFileSync(path.join(uiDir, 'background.webp'), await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#663322' },
  }).webp().toBuffer());
  saveUiSettings({
    dynamicThemeFromBg: true,
    glassTextAutoDark: false,
    glassTextDark: '#ddeeff',
  });
  await refreshBgThemePaletteFromFile();
  const ui = getUiCustomization();
  assert.equal(ui.glassTextDark, '#ddeeff');
  assert.equal(ui.dynamicThemeFromBg, true);
});

test('resetUiThemeColors clears dynamic palette mode', async () => {
  invalidateUiCustomizationCache();
  resetUiDir();
  fs.mkdirSync(uiDir, { recursive: true });
  fs.writeFileSync(path.join(uiDir, 'background.webp'), await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#224466' },
  }).webp().toBuffer());
  await refreshBgThemePaletteFromFile();
  saveUiSettings({ dynamicThemeFromBg: true });
  resetUiThemeColors();
  assert.equal(hasUiThemeColorsConfigured(), false);
  assert.equal(getSetting('ui_dynamic_theme_from_bg'), '');
});
