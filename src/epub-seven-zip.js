import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import archiver from 'archiver';
import { config } from './config.js';
import { listSevenZipEntries, readSevenZipEntry } from './seven-zip.js';
import { detectImageMimeFromBuffer } from './services/cover.js';
import { getSharp } from './services/sharp-loader.js';
import {
  readFlibustaCover,
  readFlibustaIllustrationForBook
} from './flibusta-sidecar.js';

const SEVEN_ZIP_MAGIC = Buffer.from([0x37, 0x7a, 0xbc, 0xaf]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** Как FLibrary `Epub::IMAGE_INDEX_FILE_NAME`. */
export const FLIBRARY_IMAGE_INDEX_NAME = 'FLibraryImageIndex.json';
const EPUB_RESTORE_CACHE_PREFIX = 'epub-restore-v2-';

export function isSevenZipBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer.subarray(0, 4).equals(SEVEN_ZIP_MAGIC);
}

function isZipBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer.subarray(0, 4).equals(ZIP_MAGIC);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getRepackCachePath(book) {
  const key = crypto.createHash('sha1')
    .update([
      EPUB_RESTORE_CACHE_PREFIX,
      book.id,
      book.archiveName,
      book.fileName,
      String(book.size ?? ''),
      String(book.date ?? '')
    ].join(':'))
    .digest('hex');
  return path.join(config.conversionCacheDir, `${EPUB_RESTORE_CACHE_PREFIX}${key}.epub`);
}

function normalizeRelPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function isImageIndexPath(p) {
  return normalizeRelPath(p).toLowerCase().endsWith(FLIBRARY_IMAGE_INDEX_NAME.toLowerCase());
}

/**
 * FLibrary `EpubParser::GetImageIndex`: JSON-массив `{ id, num }`.
 * `num === -1` — обложка из covers/, иначе иллюстрация images/{libId}/{num}.
 */
export function parseFlibraryImageIndex(bytes) {
  const raw = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes || '');
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(doc)) return [];
  const out = [];
  for (const item of doc) {
    if (!item || typeof item !== 'object') continue;
    const id = normalizeRelPath(item.id);
    const num = Number(item.num);
    if (!id || !Number.isFinite(num)) continue;
    out.push({ id, num });
  }
  return out;
}

export function findEpubEntryIndex(entries, id) {
  const want = normalizeRelPath(id).toLowerCase();
  if (!want) return -1;
  const list = entries || [];
  let idx = list.findIndex((e) => normalizeRelPath(e.name).toLowerCase() === want);
  if (idx >= 0) return idx;
  idx = list.findIndex((e) => normalizeRelPath(e.name).toLowerCase().endsWith(`/${want}`));
  if (idx >= 0) return idx;
  const base = want.split('/').pop();
  const matches = [];
  for (let i = 0; i < list.length; i++) {
    const name = normalizeRelPath(list[i].name).toLowerCase();
    if (name.split('/').pop() === base) matches.push(i);
  }
  return matches.length === 1 ? matches[0] : -1;
}

/**
 * Path for a newly inserted image: keep OPF-relative names when the EPUB
 * was unpacked with a stripped OEBPS/ prefix.
 */
export function resolveEpubInjectName(entries, id) {
  const existing = findEpubEntryIndex(entries, id);
  if (existing >= 0) return entries[existing].name;
  const want = normalizeRelPath(id);
  if (!want) return want;
  const names = (entries || []).map((e) => normalizeRelPath(e.name)).filter(Boolean);
  const hasOebps = names.some((n) => {
    const l = n.toLowerCase();
    return l === 'oebps' || l.startsWith('oebps/') || l.includes('/oebps/');
  });
  if (!hasOebps && want.toLowerCase().startsWith('oebps/')) {
    return want.slice(6);
  }
  const wantParts = want.split('/');
  if (wantParts.length > 2) {
    const imageNames = names.filter((n) => /\.(jpe?g|png|gif|webp|svg|jxl)$/i.test(n));
    for (let i = 1; i < wantParts.length - 1; i++) {
      const stripped = wantParts.slice(i).join('/');
      const strippedDir = wantParts.slice(i, -1).join('/').toLowerCase();
      if (imageNames.some((n) => {
        const d = n.includes('/') ? n.slice(0, n.lastIndexOf('/')).toLowerCase() : '';
        return d === strippedDir;
      })) {
        return stripped;
      }
    }
  }
  return want;
}

function imagePayloadSufficient(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return false;
  return Boolean(detectImageMimeFromBuffer(buf));
}

async function encodeForEpubPath(data, destPath) {
  if (!Buffer.isBuffer(data) || !data.length) return data;
  const ext = path.extname(String(destPath || '')).toLowerCase();
  const mime = detectImageMimeFromBuffer(data);
  const wantsJpeg = ext === '.jpg' || ext === '.jpeg';
  const wantsPng = ext === '.png';
  if (wantsJpeg && mime === 'image/jpeg') return data;
  if (wantsPng && mime === 'image/png') return data;
  if (!wantsJpeg && !wantsPng) return data;
  const sharp = await getSharp();
  if (!sharp) return data;
  try {
    if (wantsJpeg) return await sharp(data, { failOn: 'none' }).jpeg({ quality: 85 }).toBuffer();
    return await sharp(data, { failOn: 'none' }).png().toBuffer();
  } catch {
    return data;
  }
}

/**
 * Подставляет обложку и иллюстрации из FLibrary sidecar по FLibraryImageIndex.json.
 * Индекс из итогового EPUB убирается — читалкам он не нужен.
 */
export async function injectSidecarImagesIntoEntries(entries, loaders = {}) {
  const list = Array.isArray(entries) ? entries.map((e) => ({ ...e })) : [];
  const indexEntry = list.find((e) => isImageIndexPath(e.name));
  if (!indexEntry?.data?.length) {
    return { entries: list.filter((e) => !isImageIndexPath(e.name)), restored: 0, missing: 0 };
  }
  const index = parseFlibraryImageIndex(indexEntry.data);
  const readCover = loaders.readCover;
  const readIllustration = loaders.readIllustration;
  let restored = 0;
  let missing = 0;
  for (const item of index) {
    let image = null;
    try {
      if (item.num === -1) {
        image = readCover ? await readCover() : null;
      } else if (readIllustration) {
        image = await readIllustration(item.num);
      }
    } catch {
      image = null;
    }
    const data = image?.data;
    if (!Buffer.isBuffer(data) || !data.length) {
      missing += 1;
      continue;
    }
    const encoded = await encodeForEpubPath(data, item.id);
    if (!encoded?.length) {
      missing += 1;
      continue;
    }
    const existing = findEpubEntryIndex(list, item.id);
    if (existing >= 0) {
      if (imagePayloadSufficient(list[existing].data)) continue;
      list[existing] = { ...list[existing], data: encoded };
      restored += 1;
      continue;
    }
    list.push({ name: resolveEpubInjectName(list, item.id), data: encoded });
    restored += 1;
  }
  return {
    entries: list.filter((e) => !isImageIndexPath(e.name)),
    restored,
    missing
  };
}

function normalizeEpubEntryList(entries) {
  const files = (entries || [])
    .filter((entry) => entry?.path && !entry.path.endsWith('/') && !entry.path.endsWith('\\'));
  const mimetypeEntry = files.find((entry) => {
    const p = normalizeRelPath(entry.path).toLowerCase();
    return p === 'mimetype' || p.endsWith('/mimetype');
  });
  if (!mimetypeEntry) {
    throw new Error('Invalid Flibusta EPUB archive: mimetype entry not found');
  }
  const mimePath = normalizeRelPath(mimetypeEntry.path);
  const prefix = mimePath.includes('/') ? mimePath.slice(0, mimePath.lastIndexOf('/') + 1) : '';
  const relEntries = files.map((entry) => {
    const full = normalizeRelPath(entry.path);
    const rel = prefix && full.startsWith(prefix) ? full.slice(prefix.length) : full;
    return { ...entry, rel };
  }).filter((entry) => entry.rel && entry.rel !== '.');
  return { mimetypeEntry, relEntries };
}

function zipBuffers(entries) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    for (const entry of entries) {
      archive.append(entry.data, { name: entry.name, store: entry.store === true });
    }
    archive.finalize();
  });
}

function orderEpubZipEntries(entries) {
  const mime = entries.find((e) => normalizeRelPath(e.name).toLowerCase() === 'mimetype');
  const rest = entries
    .filter((e) => e !== mime)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const out = [];
  if (mime) out.push({ ...mime, name: 'mimetype', store: true });
  out.push(...rest);
  return out;
}

function sidecarLoadersForBook(book, libraryRoot) {
  const root = String(libraryRoot || '').trim();
  if (!root || !book?.archiveName) return null;
  return {
    readCover: () => readFlibustaCover(root, book.archiveName, book),
    readIllustration: (num) => readFlibustaIllustrationForBook(root, book, num)
  };
}

async function listZipEntriesFromBuffer(buffer) {
  const unzipper = (await import('unzipper')).default || (await import('unzipper'));
  const directory = await unzipper.Open.buffer(buffer);
  const files = (directory?.files || []).filter((f) => f.type !== 'Directory');
  const entries = [];
  for (const file of files) {
    const data = await file.buffer();
    entries.push({ path: file.path, data });
  }
  return entries;
}

function zipHasImageIndex(rawEntries) {
  return (rawEntries || []).some((e) => isImageIndexPath(e.path || e.name));
}

async function packEpubEntries(relEntries, mimetypeEntry, mimetypeData) {
  const zipEntries = [{ name: 'mimetype', data: mimetypeData, store: true }];
  const rest = relEntries
    .filter((entry) => entry.path !== mimetypeEntry.path)
    .sort((a, b) => String(a.rel).localeCompare(String(b.rel)));
  for (const entry of rest) {
    zipEntries.push({ name: entry.rel, data: entry.data });
  }
  return zipEntries;
}

async function unpackSevenZipEpubEntries(buffer, binOverride) {
  const tmpPath = path.join(os.tmpdir(), `epub7z-${Date.now()}-${Math.random().toString(36).slice(2)}.7z`);
  await fs.promises.writeFile(tmpPath, buffer);
  try {
    const listed = await listSevenZipEntries(tmpPath, binOverride);
    const { mimetypeEntry, relEntries } = normalizeEpubEntryList(listed);
    const withData = [];
    for (const entry of relEntries) {
      const data = await readSevenZipEntry(tmpPath, entry.path, binOverride);
      withData.push({ ...entry, data });
    }
    const mime = withData.find((e) => e.path === mimetypeEntry.path);
    return packEpubEntries(withData, mimetypeEntry, mime?.data || Buffer.from('application/epub+zip'));
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
}

function unpackListedZipEpubEntries(listed) {
  const { mimetypeEntry, relEntries } = normalizeEpubEntryList(listed);
  const mime = relEntries.find((e) => e.path === mimetypeEntry.path);
  return packEpubEntries(relEntries, mimetypeEntry, mime?.data || Buffer.from('application/epub+zip'));
}

async function restoreAndZip(entries, book, libraryRoot) {
  const loaders = sidecarLoadersForBook(book, libraryRoot);
  const injected = loaders
    ? await injectSidecarImagesIntoEntries(entries, loaders)
    : { entries: entries.filter((e) => !isImageIndexPath(e.name)), restored: 0, missing: 0 };
  const buf = await zipBuffers(orderEpubZipEntries(injected.entries));
  return { buf, missing: Number(injected.missing) || 0 };
}

async function writeRestoreCache(cachePath, buf) {
  try {
    ensureDir(config.conversionCacheDir);
    await fs.promises.writeFile(cachePath, buf);
  } catch {
    /* cache optional */
  }
}

/**
 * Flibusta/FLibrary хранит сжатый EPUB как 7z (папка OEBPS) или ZIP без картинок:
 * байты обложки и иллюстраций лежат в covers/ и images/, карта путей — в FLibraryImageIndex.json.
 * Собираем валидный EPUB (ZIP) с подставленными изображениями, как экспорт FLibrary.
 */
export async function ensureEpubZipFromBookBuffer(buffer, book, libraryRoot = '') {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return buffer;
  const needsSevenZip = isSevenZipBuffer(buffer);
  const needsZip = isZipBuffer(buffer);
  if (!needsSevenZip && !needsZip) return buffer;

  const cachePath = book?.id ? getRepackCachePath(book) : '';
  if (cachePath) {
    try {
      await fs.promises.access(cachePath, fs.constants.R_OK);
      return fs.promises.readFile(cachePath);
    } catch {
      /* build below */
    }
  }

  let entries;
  if (needsSevenZip) {
    entries = await unpackSevenZipEpubEntries(buffer, config.sevenZipPath);
  } else {
    const listed = await listZipEntriesFromBuffer(buffer);
    const hasRootMime = listed.some((e) => normalizeRelPath(e.path).toLowerCase() === 'mimetype');
    const hasIndex = zipHasImageIndex(listed);
    if (hasRootMime && !hasIndex) return buffer;
    entries = unpackListedZipEpubEntries(listed);
  }

  const restored = await restoreAndZip(entries, book, libraryRoot);
  if (cachePath && restored.missing === 0) await writeRestoreCache(cachePath, restored.buf);
  return restored.buf;
}
