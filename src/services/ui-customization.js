import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db.js';
import {
  DEFAULT_GLASS_DARK,
  DEFAULT_GLASS_LIGHT,
  LEGACY_SURFACE_DARK,
  LEGACY_SURFACE_LIGHT,
  buildThemePair,
  adjustLightTextForGlassOpacity,
  themePairToCssVars,
  deriveGlassTheme,
  normalizeHexColor,
  hexToRgb,
  relativeLuminance,
  radiusPresetToCssVars,
  shadowPresetToCssVars,
  fontSizeToCssVars,
  DEFAULT_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  MAX_FONT_SIZE_PX,
  densityToCssVars,
  fontFamilyToCssVars,
  resolveFontFamilyStack,
  UI_FONT_FAMILY_PRESETS,
} from './theme-engine.js';

export {
  DEFAULT_GLASS_DARK,
  DEFAULT_GLASS_LIGHT,
  LEGACY_SURFACE_DARK,
  LEGACY_SURFACE_LIGHT,
  deriveGlassTheme,
  normalizeHexColor,
  hexToRgb,
  relativeLuminance,
  radiusPresetToCssVars,
  shadowPresetToCssVars,
  fontSizeToCssVars,
  DEFAULT_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  MAX_FONT_SIZE_PX,
  densityToCssVars,
  fontFamilyToCssVars,
  resolveFontFamilyStack,
  UI_FONT_FAMILY_PRESETS,
} from './theme-engine.js';

const UI_DIR = path.join(config.dataDir, 'ui');
const BG_OVERLAY_MAX = 80;
const BG_OVERLAY_DEFAULT_STRENGTH = 40;

function bgContrastFromOverlayStrength(strength) {
  return BG_OVERLAY_MAX - strength;
}

function overlayStrengthFromBgContrast(contrast) {
  const value = clampInt(contrast, 0, BG_OVERLAY_MAX, bgContrastFromOverlayStrength(BG_OVERLAY_DEFAULT_STRENGTH));
  return BG_OVERLAY_MAX - value;
}
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FONT_BYTES = 2 * 1024 * 1024;
const VALID_ASSETS = new Set(['logo', 'favicon', 'background', 'font']);
const CUSTOM_FONT_BASENAME = 'custom-font';

const FONT_EXTENSIONS = {
  '.woff2': { mime: 'font/woff2', format: 'woff2' },
  '.woff': { mime: 'font/woff', format: 'woff' },
  '.ttf': { mime: 'font/ttf', format: 'truetype' },
  '.otf': { mime: 'font/otf', format: 'opentype' },
};

const SERVE_MAP = {
  logo: { file: 'logo.png', type: 'image/png' },
  favicon: { file: 'favicon-32.png', type: 'image/png' },
  'favicon-192': { file: 'favicon-192.png', type: 'image/png' },
  background: { file: 'background.webp', type: 'image/webp' },
};

function ensureUiDir() {
  fs.mkdirSync(UI_DIR, { recursive: true });
}

function clampInt(value, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const raw = Array.isArray(value) ? value[value.length - 1] : value;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function fileMtimeUrl(basePath, fileName) {
  const full = path.join(UI_DIR, fileName);
  try {
    const st = fs.statSync(full);
    return `${basePath}?v=${Math.trunc(st.mtimeMs)}`;
  } catch {
    return null;
  }
}

function sanitizeFontFamilyName(name) {
  return String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/["\\]/g, '')
    .replace(/[^\w\s\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64) || 'Custom Font';
}

function detectFontExtension(buffer, originalName = '') {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  if (FONT_EXTENSIONS[ext]) return ext;
  if (buffer.length >= 4) {
    const sig = buffer.subarray(0, 4).toString('ascii');
    if (sig === 'wOF2') return '.woff2';
    if (sig === 'wOFF') return '.woff';
    if (sig === 'OTTO') return '.otf';
    if (sig === 'true' || sig === 'typ1') return '.ttf';
    if (buffer.readUInt32BE(0) === 0x00010000) return '.ttf';
  }
  return '';
}

function readCustomFontExt() {
  const ext = getSetting('ui_custom_font_ext');
  return FONT_EXTENSIONS[ext] ? ext : '';
}

function customFontFileName(ext = readCustomFontExt()) {
  return ext ? `${CUSTOM_FONT_BASENAME}${ext}` : '';
}

function removeCustomFontFiles() {
  for (const ext of Object.keys(FONT_EXTENSIONS)) {
    try {
      fs.unlinkSync(path.join(UI_DIR, `${CUSTOM_FONT_BASENAME}${ext}`));
    } catch {
      /* ignore missing */
    }
  }
}

function readFontFamilySetting() {
  const raw = getSetting('ui_font_family');
  return UI_FONT_FAMILY_PRESETS.includes(raw) ? raw : (raw === '' ? 'inter' : 'inter');
}

function legacyFontSizeFromScale() {
  const legacy = getSetting('ui_font_scale');
  if (legacy === 'small') return 13;
  if (legacy === 'large') return 16;
  return DEFAULT_FONT_SIZE_PX;
}

function readFontSizeSetting() {
  const raw = getSetting('ui_font_size');
  if (raw !== '') return clampInt(raw, MIN_FONT_SIZE_PX, MAX_FONT_SIZE_PX, DEFAULT_FONT_SIZE_PX);
  return legacyFontSizeFromScale();
}

function isFontSizeCustomized() {
  if (getSetting('ui_font_size') !== '') return true;
  const legacy = getSetting('ui_font_scale');
  return legacy === 'small' || legacy === 'large';
}

function hasCustomFontFile() {
  return Boolean(readCustomFontExt() && fs.existsSync(path.join(UI_DIR, customFontFileName())));
}

/** Совместимость: раньше был in-process кэш, теперь читаем файлы с диска каждый раз. */
export function invalidateUiCustomizationCache() {}

function readSurfaceOpacity() {
  const unifiedRaw = getSetting('ui_surface_opacity');
  if (unifiedRaw !== '') return clampInt(unifiedRaw, 0, 100, 88);
  for (const key of ['ui_panel_opacity', 'ui_topbar_opacity', 'ui_sidebar_opacity']) {
    const raw = getSetting(key);
    if (raw !== '') return clampInt(raw, 0, 100, 88);
  }
  return 88;
}

/** Saved appearance theme settings (independent of custom background image). */
export function hasUiThemeConfigured() {
  return hasUiThemeColorsConfigured() || hasUiThemeSlidersConfigured();
}

export function hasUiThemeColorsConfigured() {
  const textDark = getSetting('ui_glass_text_dark');
  const textLight = getSetting('ui_glass_text_light');
  if (textDark !== '' || textLight !== '') return true;
  const mutedDark = getSetting('ui_glass_muted_dark');
  const mutedLight = getSetting('ui_glass_muted_light');
  if (mutedDark !== '' || mutedLight !== '') return true;
  const linkDark = getSetting('ui_glass_link_dark');
  const linkLight = getSetting('ui_glass_link_light');
  if (linkDark !== '' || linkLight !== '') return true;
  const dark = getSetting('ui_glass_color_dark');
  const light = getSetting('ui_glass_color_light');
  if (dark !== '' && normalizeHexColor(dark, LEGACY_SURFACE_DARK) !== LEGACY_SURFACE_DARK) return true;
  if (light !== '' && normalizeHexColor(light, LEGACY_SURFACE_LIGHT) !== LEGACY_SURFACE_LIGHT) return true;
  return false;
}

export function hasUiThemeSlidersConfigured() {
  const keys = [
    'ui_bg_blur',
    'ui_bg_overlay',
    'ui_surface_opacity',
    'ui_surface_blur',
    'ui_panel_opacity',
    'ui_topbar_opacity',
    'ui_sidebar_opacity',
  ];
  return keys.some((key) => getSetting(key) !== '');
}

export function hasUiThemeShapeConfigured() {
  const keys = ['ui_radius_preset', 'ui_shadow_preset'];
  return keys.some((key) => getSetting(key) !== '');
}

export function hasUiThemeTypographyConfigured() {
  if (isFontSizeCustomized()) return true;
  if (getSetting('ui_density') !== '') return true;
  if (getSetting('ui_font_family') !== '') return true;
  return hasCustomFontFile();
}

export function resetUiThemeColors() {
  setSetting('ui_glass_color_dark', '');
  setSetting('ui_glass_color_light', '');
  setSetting('ui_glass_text_dark', '');
  setSetting('ui_glass_text_light', '');
  setSetting('ui_glass_muted_dark', '');
  setSetting('ui_glass_muted_light', '');
  setSetting('ui_glass_link_dark', '');
  setSetting('ui_glass_link_light', '');
  invalidateUiCustomizationCache();
}

function deriveLinkHover(linkHex, surfaceHex) {
  const isDark = relativeLuminance(...hexToRgb(surfaceHex)) < 0.45;
  const [r, g, b] = hexToRgb(linkHex);
  const shift = isDark ? 18 : -14;
  const clamp = (v) => Math.min(255, Math.max(0, v + shift));
  return normalizeHexColor(
    `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`,
    linkHex,
  );
}

function applyGlassPaletteOverrides(palette, { mutedRaw, linkRaw }) {
  if (mutedRaw) {
    palette.muted = normalizeHexColor(mutedRaw, palette.muted);
  }
  if (linkRaw) {
    palette.link = normalizeHexColor(linkRaw, palette.link);
    palette.linkHover = deriveLinkHover(palette.link, palette.surface);
  }
}

export function resetUiThemeSliders() {
  for (const key of [
    'ui_bg_blur',
    'ui_bg_overlay',
    'ui_surface_opacity',
    'ui_surface_blur',
    'ui_panel_opacity',
    'ui_topbar_opacity',
    'ui_sidebar_opacity',
  ]) {
    setSetting(key, '');
  }
  invalidateUiCustomizationCache();
}

export function resetUiThemeShape() {
  setSetting('ui_radius_preset', '');
  setSetting('ui_shadow_preset', '');
  invalidateUiCustomizationCache();
}

export function resetUiThemeTypography() {
  setSetting('ui_font_size', '');
  setSetting('ui_font_scale', '');
  setSetting('ui_density', '');
  setSetting('ui_font_family', '');
  setSetting('ui_custom_font_name', '');
  setSetting('ui_custom_font_ext', '');
  ensureUiDir();
  removeCustomFontFiles();
  invalidateUiCustomizationCache();
}

export function getUiCustomization() {
  ensureUiDir();
  const blurRaw = getSetting('ui_bg_blur');
  const overlayRaw = getSetting('ui_bg_overlay');
  const blur = blurRaw === '' ? 0 : clampInt(blurRaw, 0, 24, 0);
  const overlay = overlayRaw === '' ? BG_OVERLAY_DEFAULT_STRENGTH : clampInt(overlayRaw, 0, BG_OVERLAY_MAX, BG_OVERLAY_DEFAULT_STRENGTH);
  const bgContrast = bgContrastFromOverlayStrength(overlay);
  const surfaceOpacity = readSurfaceOpacity();
  const surfaceBlurRaw = getSetting('ui_surface_blur');
  const surfaceBlur = surfaceBlurRaw === '' ? 0 : clampInt(surfaceBlurRaw, 0, 24, 0);
  const showLogoOnLogin = getSetting('ui_show_logo_login') !== '0';
  const radiusPreset = getSetting('ui_radius_preset') || 'rounded';
  const shadowPreset = getSetting('ui_shadow_preset') || 'normal';
  const fontSize = readFontSizeSetting();
  const density = getSetting('ui_density') || 'normal';
  let fontFamily = readFontFamilySetting();
  const customFontExt = readCustomFontExt();
  const customFontName = getSetting('ui_custom_font_name') || 'Custom Font';
  const customFontFile = customFontFileName(customFontExt);
  const customFontUrl = customFontFile ? fileMtimeUrl('/custom/ui/font', customFontFile) : null;
  if (fontFamily === 'custom' && !customFontUrl) fontFamily = 'inter';
  const glassColorDarkRaw = getSetting('ui_glass_color_dark');
  const glassColorLightRaw = getSetting('ui_glass_color_light');
  const glassTextDarkRaw = getSetting('ui_glass_text_dark');
  const glassTextLightRaw = getSetting('ui_glass_text_light');
  const glassMutedDarkRaw = getSetting('ui_glass_muted_dark');
  const glassMutedLightRaw = getSetting('ui_glass_muted_light');
  const glassLinkDarkRaw = getSetting('ui_glass_link_dark');
  const glassLinkLightRaw = getSetting('ui_glass_link_light');
  const displayDark = glassColorDarkRaw
    ? normalizeHexColor(glassColorDarkRaw, LEGACY_SURFACE_DARK)
    : LEGACY_SURFACE_DARK;
  const displayLight = glassColorLightRaw
    ? normalizeHexColor(glassColorLightRaw, LEGACY_SURFACE_LIGHT)
    : LEGACY_SURFACE_LIGHT;
  const themePair = buildThemePair(
    displayDark,
    displayLight,
    glassTextDarkRaw,
    glassTextLightRaw,
  );
  if (hasUiThemeColorsConfigured()) {
    themePair.light = adjustLightTextForGlassOpacity(themePair.light, surfaceOpacity);
  }
  applyGlassPaletteOverrides(themePair.dark, { mutedRaw: glassMutedDarkRaw, linkRaw: glassLinkDarkRaw });
  applyGlassPaletteOverrides(themePair.light, { mutedRaw: glassMutedLightRaw, linkRaw: glassLinkLightRaw });
  const logoUrl = fileMtimeUrl('/custom/ui/logo', 'logo.png');
  const faviconUrl = fileMtimeUrl('/custom/ui/favicon', 'favicon-32.png');
  const faviconAppleUrl = fileMtimeUrl('/custom/ui/favicon-192', 'favicon-192.png');
  const backgroundUrl = fileMtimeUrl('/custom/ui/background', 'background.webp');
  return {
    blur,
    overlay,
    bgContrast,
    surfaceOpacity,
    surfaceBlur,
    showLogoOnLogin,
    glassColorDark: themePair.dark.surface,
    glassColorLight: themePair.light.surface,
    glassTextDark: themePair.dark.text,
    glassTextLight: themePair.light.text,
    glassMutedDark: themePair.dark.muted,
    glassMutedLight: themePair.light.muted,
    glassLinkDark: themePair.dark.link,
    glassLinkLight: themePair.light.link,
    glassTextAutoDark: themePair.dark.textAuto,
    glassTextAutoLight: themePair.light.textAuto,
    glassMutedAutoDark: glassMutedDarkRaw === '',
    glassMutedAutoLight: glassMutedLightRaw === '',
    glassLinkAutoDark: glassLinkDarkRaw === '',
    glassLinkAutoLight: glassLinkLightRaw === '',
    themePair,
    logoUrl,
    faviconUrl,
    faviconAppleUrl,
    backgroundUrl,
    hasBackground: Boolean(backgroundUrl),
    hasLogo: Boolean(logoUrl),
    radiusPreset,
    shadowPreset,
    fontSize,
    density,
    fontFamily,
    customFontName,
    customFontUrl,
    customFontFormat: FONT_EXTENSIONS[customFontExt]?.format || '',
    hasCustomFont: Boolean(customFontUrl),
    hasCustomThemeColors: hasUiThemeColorsConfigured(),
    hasCustomThemeSliders: hasUiThemeSlidersConfigured(),
    hasCustomThemeShape: hasUiThemeShapeConfigured(),
    hasCustomThemeTypography: hasUiThemeTypographyConfigured(),
  };
}

export function getThemeCssVars() {
  const ui = getUiCustomization();
  const colors = hasUiThemeColorsConfigured();
  const sliders = hasUiThemeSlidersConfigured();
  const shape = hasUiThemeShapeConfigured();
  const typography = hasUiThemeTypographyConfigured();
  const panels = sliders || colors || ui.hasBackground;
  if (!colors && !panels && !ui.hasBackground && !shape && !typography) return [];
  const vars = [];
  if (colors) {
    vars.push(...themePairToCssVars(ui.themePair));
  } else if (ui.hasBackground) {
    vars.push(
      `--ui-theme-dark-bg-overlay-color:${ui.themePair.dark.bgOverlayColor}`,
      `--ui-theme-light-bg-overlay-color:${ui.themePair.light.bgOverlayColor}`,
    );
  }
  if (panels) {
    vars.push(
      `--ui-surface-opacity:${ui.surfaceOpacity}`,
      `--ui-surface-blur:${ui.surfaceBlur}px`,
    );
  }
  if (ui.hasBackground) {
    vars.push(
      `--ui-bg-image:url("${ui.backgroundUrl}")`,
      `--ui-bg-blur:${ui.blur}px`,
      `--ui-bg-overlay:${ui.overlay}`,
    );
  }
  if (shape) {
    vars.push(...radiusPresetToCssVars(ui.radiusPreset));
    vars.push(...shadowPresetToCssVars(ui.shadowPreset));
  }
  if (typography) {
    vars.push(...fontSizeToCssVars(ui.fontSize));
    vars.push(...densityToCssVars(ui.density));
  }
  if (ui.fontFamily !== 'inter') {
    vars.push(...fontFamilyToCssVars(ui.fontFamily, ui.customFontName));
  }
  return vars;
}

export function saveUiSettings({
  bgBlur,
  bgOverlay,
  surfaceOpacity,
  surfaceBlur,
  glassColorDark,
  glassColorLight,
  glassTextDark,
  glassTextLight,
  glassTextAutoDark,
  glassTextAutoLight,
  glassMutedDark,
  glassMutedLight,
  glassMutedAutoDark,
  glassMutedAutoLight,
  glassLinkDark,
  glassLinkLight,
  glassLinkAutoDark,
  glassLinkAutoLight,
  showLogoOnLogin,
} = {}) {
  if (bgBlur !== undefined) {
    setSetting('ui_bg_blur', String(clampInt(bgBlur, 0, 24, 0)));
  }
  if (bgOverlay !== undefined) {
    setSetting('ui_bg_overlay', String(overlayStrengthFromBgContrast(bgOverlay)));
  }
  if (surfaceOpacity !== undefined) {
    setSetting('ui_surface_opacity', String(clampInt(surfaceOpacity, 0, 100, 88)));
  }
  if (surfaceBlur !== undefined) {
    setSetting('ui_surface_blur', String(clampInt(surfaceBlur, 0, 24, 0)));
  }
  if (glassColorDark !== undefined) {
    const palette = buildThemePair(glassColorDark, DEFAULT_GLASS_LIGHT).dark;
    setSetting('ui_glass_color_dark', palette.surface);
  }
  if (glassColorLight !== undefined) {
    const palette = buildThemePair(DEFAULT_GLASS_DARK, glassColorLight).light;
    setSetting('ui_glass_color_light', palette.surface);
  }
  if (glassTextAutoDark !== undefined || glassTextDark !== undefined) {
    const auto = glassTextAutoDark === true || glassTextAutoDark === '1' || glassTextAutoDark === 1;
    if (auto) {
      setSetting('ui_glass_text_dark', '');
    } else if (glassTextDark !== undefined) {
      const surface = glassColorDark !== undefined ? glassColorDark : getSetting('ui_glass_color_dark');
      const palette = buildThemePair(surface || DEFAULT_GLASS_DARK, DEFAULT_GLASS_LIGHT, glassTextDark, '');
      setSetting('ui_glass_text_dark', palette.dark.text);
    }
  }
  if (glassTextAutoLight !== undefined || glassTextLight !== undefined) {
    const auto = glassTextAutoLight === true || glassTextAutoLight === '1' || glassTextAutoLight === 1;
    if (auto) {
      setSetting('ui_glass_text_light', '');
    } else if (glassTextLight !== undefined) {
      const surface = glassColorLight !== undefined ? glassColorLight : getSetting('ui_glass_color_light');
      const palette = buildThemePair(DEFAULT_GLASS_DARK, surface || DEFAULT_GLASS_LIGHT, '', glassTextLight);
      setSetting('ui_glass_text_light', palette.light.text);
    }
  }
  if (glassMutedAutoDark !== undefined || glassMutedDark !== undefined) {
    const auto = glassMutedAutoDark === true || glassMutedAutoDark === '1' || glassMutedAutoDark === 1;
    if (auto) setSetting('ui_glass_muted_dark', '');
    else if (glassMutedDark !== undefined) {
      setSetting('ui_glass_muted_dark', normalizeHexColor(glassMutedDark, ''));
    }
  }
  if (glassMutedAutoLight !== undefined || glassMutedLight !== undefined) {
    const auto = glassMutedAutoLight === true || glassMutedAutoLight === '1' || glassMutedAutoLight === 1;
    if (auto) setSetting('ui_glass_muted_light', '');
    else if (glassMutedLight !== undefined) {
      setSetting('ui_glass_muted_light', normalizeHexColor(glassMutedLight, ''));
    }
  }
  if (glassLinkAutoDark !== undefined || glassLinkDark !== undefined) {
    const auto = glassLinkAutoDark === true || glassLinkAutoDark === '1' || glassLinkAutoDark === 1;
    if (auto) setSetting('ui_glass_link_dark', '');
    else if (glassLinkDark !== undefined) {
      setSetting('ui_glass_link_dark', normalizeHexColor(glassLinkDark, ''));
    }
  }
  if (glassLinkAutoLight !== undefined || glassLinkLight !== undefined) {
    const auto = glassLinkAutoLight === true || glassLinkAutoLight === '1' || glassLinkAutoLight === 1;
    if (auto) setSetting('ui_glass_link_light', '');
    else if (glassLinkLight !== undefined) {
      setSetting('ui_glass_link_light', normalizeHexColor(glassLinkLight, ''));
    }
  }
  if (showLogoOnLogin !== undefined) {
    setSetting('ui_show_logo_login', showLogoOnLogin ? '1' : '0');
  }
  invalidateUiCustomizationCache();
}

export function saveUiShapeSettings({
  radiusPreset,
  shadowPreset,
} = {}) {
  if (radiusPreset !== undefined) {
    const valid = ['sharp', 'rounded', 'pill'].includes(radiusPreset) ? radiusPreset : '';
    setSetting('ui_radius_preset', valid);
  }
  if (shadowPreset !== undefined) {
    const valid = ['none', 'subtle', 'normal', 'pronounced'].includes(shadowPreset) ? shadowPreset : '';
    setSetting('ui_shadow_preset', valid);
  }
  invalidateUiCustomizationCache();
}

export function saveUiTypographySettings({
  fontSize,
  density,
  fontFamily,
} = {}) {
  if (fontSize !== undefined) {
    const size = clampInt(fontSize, MIN_FONT_SIZE_PX, MAX_FONT_SIZE_PX, DEFAULT_FONT_SIZE_PX);
    setSetting('ui_font_size', size === DEFAULT_FONT_SIZE_PX ? '' : String(size));
    setSetting('ui_font_scale', '');
  }
  if (density !== undefined) {
    const valid = ['compact', 'normal', 'comfortable'].includes(density) ? density : '';
    setSetting('ui_density', valid);
  }
  if (fontFamily !== undefined) {
    const normalized = String(fontFamily || '').trim();
    if (!UI_FONT_FAMILY_PRESETS.includes(normalized) || normalized === 'inter') {
      setSetting('ui_font_family', '');
    } else if (normalized === 'custom') {
      if (!hasCustomFontFile()) throw new Error('admin.ui.errorFontRequired');
      setSetting('ui_font_family', 'custom');
    } else {
      setSetting('ui_font_family', normalized);
    }
  }
  invalidateUiCustomizationCache();
}

export async function saveUiAsset(asset, buffer, options = {}) {
  if (!VALID_ASSETS.has(asset)) throw new Error('admin.ui.errorUnknownAsset');
  if (!buffer || !buffer.length) throw new Error('admin.ui.errorEmptyFile');
  if (asset === 'font') {
    await saveUiFontFile(buffer, options.originalName || '');
    return;
  }
  if (buffer.length > MAX_BYTES) throw new Error('admin.ui.errorTooLarge');

  ensureUiDir();
  const image = sharp(buffer, { failOn: 'error' }).rotate();
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error('admin.ui.errorInvalidImage');

  if (asset === 'logo') {
    const out = await image
      .clone()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    fs.writeFileSync(path.join(UI_DIR, 'logo.png'), out);
  } else if (asset === 'favicon') {
    const png32 = await image.clone().resize(32, 32, { fit: 'cover' }).png().toBuffer();
    const png192 = await image.clone().resize(192, 192, { fit: 'cover' }).png().toBuffer();
    fs.writeFileSync(path.join(UI_DIR, 'favicon-32.png'), png32);
    fs.writeFileSync(path.join(UI_DIR, 'favicon-192.png'), png192);
  } else if (asset === 'background') {
    const out = await image
      .clone()
      .resize(2560, 2560, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    fs.writeFileSync(path.join(UI_DIR, 'background.webp'), out);
  }

  invalidateUiCustomizationCache();
}

export async function saveUiFontFile(buffer, originalName = '') {
  if (!buffer || !buffer.length) throw new Error('admin.ui.errorEmptyFile');
  if (buffer.length > MAX_FONT_BYTES) throw new Error('admin.ui.errorFontTooLarge');
  const ext = detectFontExtension(buffer, originalName);
  if (!ext) throw new Error('admin.ui.errorInvalidFont');
  ensureUiDir();
  removeCustomFontFiles();
  fs.writeFileSync(path.join(UI_DIR, `${CUSTOM_FONT_BASENAME}${ext}`), buffer);
  setSetting('ui_custom_font_ext', ext);
  setSetting('ui_custom_font_name', sanitizeFontFamilyName(originalName));
  setSetting('ui_font_family', 'custom');
  invalidateUiCustomizationCache();
}

export function removeUiAsset(asset) {
  if (!VALID_ASSETS.has(asset)) throw new Error('admin.ui.errorUnknownAsset');
  ensureUiDir();
  if (asset === 'font') {
    removeCustomFontFiles();
    setSetting('ui_custom_font_ext', '');
    setSetting('ui_custom_font_name', '');
    if (getSetting('ui_font_family') === 'custom') setSetting('ui_font_family', '');
    invalidateUiCustomizationCache();
    return;
  }
  const files = {
    logo: ['logo.png'],
    favicon: ['favicon-32.png', 'favicon-192.png'],
    background: ['background.webp'],
  }[asset];
  for (const fileName of files) {
    try {
      fs.unlinkSync(path.join(UI_DIR, fileName));
    } catch {
      /* ignore missing */
    }
  }
}

export function serveUiAsset(asset, res) {
  if (asset === 'font') {
    const ext = readCustomFontExt();
    const fileName = customFontFileName(ext);
    if (!fileName) return false;
    const full = path.join(UI_DIR, fileName);
    if (!fs.existsSync(full)) return false;
    res.type(FONT_EXTENSIONS[ext]?.mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(full);
    return true;
  }
  const spec = SERVE_MAP[asset];
  if (!spec) return false;
  const full = path.join(UI_DIR, spec.file);
  if (!fs.existsSync(full)) return false;
  res.type(spec.type);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(full);
  return true;
}

export function getPublicUiSettingsJson() {
  const ui = getUiCustomization();
  return {
    logoUrl: ui.logoUrl,
    faviconUrl: ui.faviconUrl,
    faviconAppleUrl: ui.faviconAppleUrl,
    backgroundUrl: ui.backgroundUrl,
    bgBlur: ui.blur,
    bgOverlay: ui.bgContrast,
    surfaceOpacity: ui.surfaceOpacity,
    surfaceBlur: ui.surfaceBlur,
    glassColorDark: ui.glassColorDark,
    glassColorLight: ui.glassColorLight,
    glassTextDark: ui.glassTextDark,
    glassTextLight: ui.glassTextLight,
    glassTextAutoDark: ui.glassTextAutoDark,
    glassTextAutoLight: ui.glassTextAutoLight,
    showLogoOnLogin: ui.showLogoOnLogin,
    radiusPreset: ui.radiusPreset,
    shadowPreset: ui.shadowPreset,
    fontSize: ui.fontSize,
    density: ui.density,
    fontFamily: ui.fontFamily,
    customFontUrl: ui.customFontUrl,
  };
}
