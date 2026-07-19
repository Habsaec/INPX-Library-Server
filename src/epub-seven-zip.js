import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import archiver from 'archiver';
import { config } from './config.js';
import { listSevenZipEntries, readSevenZipEntry } from './seven-zip.js';

const SEVEN_ZIP_MAGIC = Buffer.from([0x37, 0x7a, 0xbc, 0xaf]);

export function isSevenZipBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer.subarray(0, 4).equals(SEVEN_ZIP_MAGIC);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getRepackCachePath(book) {
  const key = crypto.createHash('sha1')
    .update([book.id, book.archiveName, book.fileName, String(book.size ?? ''), String(book.date ?? '')].join(':'))
    .digest('hex');
  return path.join(config.conversionCacheDir, `epub7z-${key}.epub`);
}

function normalizeSevenZipEpubEntries(entries) {
  const files = (entries || [])
    .filter((entry) => entry?.path && !entry.path.endsWith('/') && !entry.path.endsWith('\\'))
    .filter((entry) => !/flibraryimageindex\.json$/i.test(entry.path));
  const mimetypeEntry = files.find((entry) => {
    const p = String(entry.path).replace(/\\/g, '/').toLowerCase();
    return p === 'mimetype' || p.endsWith('/mimetype');
  });
  if (!mimetypeEntry) {
    throw new Error('Invalid Flibusta EPUB archive: mimetype entry not found');
  }
  const mimePath = String(mimetypeEntry.path).replace(/\\/g, '/');
  const prefix = mimePath.includes('/') ? mimePath.slice(0, mimePath.lastIndexOf('/') + 1) : '';
  const relEntries = files.map((entry) => {
    const full = String(entry.path).replace(/\\/g, '/');
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

async function repackSevenZipFolderAsEpub(buffer, binOverride) {
  ensureDir(config.conversionCacheDir);
  const tmpPath = path.join(os.tmpdir(), `epub7z-${Date.now()}-${Math.random().toString(36).slice(2)}.7z`);
  await fs.promises.writeFile(tmpPath, buffer);
  try {
    const entries = await listSevenZipEntries(tmpPath, binOverride);
    const { mimetypeEntry, relEntries } = normalizeSevenZipEpubEntries(entries);
    const zipEntries = [];
    const mimetypeData = await readSevenZipEntry(tmpPath, mimetypeEntry.path, binOverride);
    zipEntries.push({ name: 'mimetype', data: mimetypeData, store: true });
    const rest = relEntries
      .filter((entry) => entry.path !== mimetypeEntry.path)
      .sort((a, b) => String(a.rel).localeCompare(String(b.rel)));
    for (const entry of rest) {
      const data = await readSevenZipEntry(tmpPath, entry.path, binOverride);
      zipEntries.push({ name: entry.rel, data });
    }
    return zipBuffers(zipEntries);
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
}

/**
 * Flibusta хранит «.epub» внутри .7z как отдельный .7z с папкой OEBPS, а не ZIP.
 * Собираем валидный EPUB (ZIP) для читалки и скачивания.
 */
export async function ensureEpubZipFromBookBuffer(buffer, book) {
  if (!isSevenZipBuffer(buffer)) {
    return buffer;
  }
  const cachePath = getRepackCachePath(book);
  try {
    await fs.promises.access(cachePath, fs.constants.R_OK);
    return fs.promises.readFile(cachePath);
  } catch {
    /* build below */
  }
  const repacked = await repackSevenZipFolderAsEpub(buffer, config.sevenZipPath);
  try {
    await fs.promises.writeFile(cachePath, repacked);
  } catch {
    /* cache optional */
  }
  return repacked;
}
