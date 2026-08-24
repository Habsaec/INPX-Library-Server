import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSevenZipBuffer,
  parseFlibraryImageIndex,
  findEpubEntryIndex,
  injectSidecarImagesIntoEntries,
  resolveEpubInjectName
} from '../src/epub-seven-zip.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test('isSevenZipBuffer detects 7z magic', () => {
  assert.equal(isSevenZipBuffer(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27])), true);
  assert.equal(isSevenZipBuffer(Buffer.from('PK\x03\x04')), false);
  assert.equal(isSevenZipBuffer(Buffer.alloc(0)), false);
});

test('parseFlibraryImageIndex reads FLibrary {id,num} array', () => {
  const json = Buffer.from(JSON.stringify([
    { id: 'OEBPS/Images/cover.jpg', num: -1 },
    { id: 'OEBPS/Images/p1.png', num: 0 },
    { id: 'skip-me' },
    { num: 2 }
  ]));
  assert.deepEqual(parseFlibraryImageIndex(json), [
    { id: 'OEBPS/Images/cover.jpg', num: -1 },
    { id: 'OEBPS/Images/p1.png', num: 0 }
  ]);
  assert.deepEqual(parseFlibraryImageIndex(Buffer.from('{nope}')), []);
  assert.deepEqual(parseFlibraryImageIndex(Buffer.from('{}')), []);
});

test('findEpubEntryIndex matches stripped and nested paths', () => {
  const entries = [
    { name: 'mimetype' },
    { name: 'Images/cover.jpg' },
    { name: 'Images/p1.png' }
  ];
  assert.equal(findEpubEntryIndex(entries, 'Images/cover.jpg'), 1);
  assert.equal(findEpubEntryIndex(entries, 'OEBPS/Images/cover.jpg'), 1);
  assert.equal(findEpubEntryIndex(entries, 'p1.png'), 2);
  assert.equal(findEpubEntryIndex(entries, 'missing.png'), -1);
});

test('injectSidecarImagesIntoEntries fills empty images and drops the index', async () => {
  const empty = Buffer.alloc(0);
  const entries = [
    { name: 'mimetype', data: Buffer.from('application/epub+zip'), store: true },
    { name: 'Images/cover.png', data: empty },
    { name: 'Images/ill.png', data: empty },
    {
      name: 'FLibraryImageIndex.json',
      data: Buffer.from(JSON.stringify([
        { id: 'Images/cover.png', num: -1 },
        { id: 'Images/ill.png', num: 0 }
      ]))
    }
  ];
  const { entries: out, restored } = await injectSidecarImagesIntoEntries(entries, {
    readCover: async () => ({ data: PNG_1X1, contentType: 'image/png' }),
    readIllustration: async (num) => (num === 0 ? { data: PNG_1X1, contentType: 'image/png' } : null)
  });
  assert.equal(restored, 2);
  assert.equal(out.some((e) => /flibraryimageindex\.json$/i.test(e.name)), false);
  const cover = out.find((e) => e.name === 'Images/cover.png');
  const ill = out.find((e) => e.name === 'Images/ill.png');
  assert.ok(cover.data.equals(PNG_1X1));
  assert.ok(ill.data.equals(PNG_1X1));
});

test('injectSidecarImagesIntoEntries keeps already embedded images', async () => {
  const entries = [
    { name: 'Images/cover.jpg', data: PNG_1X1 },
    {
      name: 'FLibraryImageIndex.json',
      data: Buffer.from(JSON.stringify([{ id: 'Images/cover.jpg', num: -1 }]))
    }
  ];
  const { entries: out, restored } = await injectSidecarImagesIntoEntries(entries, {
    readCover: async () => ({ data: Buffer.from('not-used'), contentType: 'image/jpeg' })
  });
  assert.equal(restored, 0);
  assert.ok(out.find((e) => e.name === 'Images/cover.jpg').data.equals(PNG_1X1));
});

test('resolveEpubInjectName strips OEBPS prefix to match unpacked entries', () => {
  const entries = [
    { name: 'mimetype' },
    { name: 'Images/cover.jpg' },
    { name: 'Images/p1.png' }
  ];
  assert.equal(resolveEpubInjectName(entries, 'OEBPS/Images/missing.png'), 'Images/missing.png');
  assert.equal(resolveEpubInjectName(entries, 'Images/cover.jpg'), 'Images/cover.jpg');
});

test('injectSidecarImagesIntoEntries places missing files on OPF-relative paths', async () => {
  const entries = [
    { name: 'mimetype', data: Buffer.from('application/epub+zip'), store: true },
    { name: 'Images/cover.png', data: PNG_1X1 },
    {
      name: 'FLibraryImageIndex.json',
      data: Buffer.from(JSON.stringify([
        { id: 'OEBPS/Images/cover.png', num: -1 },
        { id: 'OEBPS/Images/ill.png', num: 0 }
      ]))
    }
  ];
  const { entries: out, restored, missing } = await injectSidecarImagesIntoEntries(entries, {
    readCover: async () => ({ data: PNG_1X1, contentType: 'image/png' }),
    readIllustration: async (num) => (num === 0 ? { data: PNG_1X1, contentType: 'image/png' } : null)
  });
  assert.equal(restored, 1);
  assert.equal(missing, 0);
  assert.ok(out.find((e) => e.name === 'Images/ill.png'));
  assert.equal(out.some((e) => e.name === 'OEBPS/Images/ill.png'), false);
});

test('injectSidecarImagesIntoEntries counts missing sidecars', async () => {
  const entries = [
    { name: 'Images/cover.png', data: Buffer.alloc(0) },
    {
      name: 'FLibraryImageIndex.json',
      data: Buffer.from(JSON.stringify([{ id: 'Images/cover.png', num: -1 }]))
    }
  ];
  const { restored, missing } = await injectSidecarImagesIntoEntries(entries, {
    readCover: async () => null
  });
  assert.equal(restored, 0);
  assert.equal(missing, 1);
});
