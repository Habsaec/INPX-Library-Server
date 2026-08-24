import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  createUser,
  db,
  getReadingPosition,
  initDb,
  migrateReadingPositionToV4,
  rebuildActiveBooksView,
  setReadingPositionCas,
} from '../src/db.js';
import { registerReaderRoutes } from '../src/routes/reader.js';

const USERNAME = 'position_v2_user';
const PASSWORD = 'PositionV2Pass1';
const BOOK_IDS = {
  dbFb2: 'position-v2-db-fb2',
  dbEpub: 'position-v2-db-epub',
  dbCas: 'position-v2-db-cas',
  dbMissing: 'position-v2-db-missing',
  apiFb2: 'position-v2-api-fb2',
  apiMissing: 'position-v3-api-missing',
  apiEpub: 'position-v2-api-epub',
  apiCas: 'position-v2-api-cas',
  apiReadState: 'position-v4-api-read-state',
};

function insertBook(id, ext) {
  db.prepare(`
    INSERT OR IGNORE INTO books (id, title, authors, genres, file_name, archive_name, ext)
    VALUES (?, ?, '', '', ?, '', ?)
  `).run(id, id, `${id}.${ext}`, ext);
}

function insertLegacyPosition(bookId, values = {}) {
  db.prepare(`
    INSERT INTO reading_positions (
      username, book_id, position, progress, fraction, fb2_href,
      section_index, section_page_fraction, paginator_page, paginator_pages, layout_mode,
      position_version, revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    USERNAME,
    bookId,
    values.position ?? 'legacy-position',
    values.progress ?? 42,
    values.fraction ?? 0.42,
    values.fb2Href ?? '4#2',
    values.sectionIndex ?? 4,
    values.sectionPageFraction ?? 0.25,
    values.paginatorPage ?? 7,
    values.paginatorPages ?? 20,
    values.layoutMode ?? 'paginated',
    values.positionVersion ?? 1,
    values.revision ?? 1,
  );
}

function clearPosition(bookId) {
  db.prepare('DELETE FROM reading_positions WHERE username = ? AND book_id = ?').run(USERNAME, bookId);
}

describe('reading position v4 storage', () => {
  before(() => {
    initDb();
    for (const id of Object.values(BOOK_IDS)) {
      insertBook(id, id.includes('fb2') ? 'fb2' : 'epub');
    }
  });

  it('adds legacy defaults and lazily resets FB2 exactly once', () => {
    clearPosition(BOOK_IDS.dbFb2);
    insertLegacyPosition(BOOK_IDS.dbFb2, { positionVersion: 3 });
    const legacy = getReadingPosition(USERNAME, BOOK_IDS.dbFb2);
    assert.equal(legacy.positionVersion, 3);
    assert.equal(legacy.revision, 1);

    const migrated = migrateReadingPositionToV4(USERNAME, BOOK_IDS.dbFb2, { reset: true });
    assert.deepEqual(
      {
        position: migrated.position,
        progress: migrated.progress,
        fraction: migrated.fraction,
        fb2Href: migrated.fb2Href,
        sectionIndex: migrated.sectionIndex,
        sectionPageFraction: migrated.sectionPageFraction,
        paginatorPage: migrated.paginatorPage,
        paginatorPages: migrated.paginatorPages,
        layoutMode: migrated.layoutMode,
        textOffset: migrated.textOffset,
        textQuote: migrated.textQuote,
        textSectionLength: migrated.textSectionLength,
        positionVersion: migrated.positionVersion,
        revision: migrated.revision,
      },
      {
        position: '',
        progress: 0,
        fraction: null,
        fb2Href: null,
        sectionIndex: null,
        sectionPageFraction: null,
        paginatorPage: null,
        paginatorPages: null,
        layoutMode: null,
        textOffset: null,
        textQuote: null,
        textSectionLength: null,
        positionVersion: 4,
        revision: 2,
      },
    );

    const repeated = migrateReadingPositionToV4(USERNAME, BOOK_IDS.dbFb2, { reset: true });
    assert.equal(repeated.revision, 2);
  });

  it('migrates an existing v3 non-FB2 row once, preserving only its CFI', () => {
    clearPosition(BOOK_IDS.dbEpub);
    insertLegacyPosition(BOOK_IDS.dbEpub, {
      position: 'epubcfi(/6/4)',
      positionVersion: 3,
      revision: 7,
    });
    const migrated = migrateReadingPositionToV4(USERNAME, BOOK_IDS.dbEpub);
    assert.equal(migrated.position, 'epubcfi(/6/4)');
    assert.equal(migrated.progress, 0);
    assert.equal(migrated.fraction, null);
    assert.equal(migrated.fb2Href, null);
    assert.equal(migrated.sectionIndex, null);
    assert.equal(migrated.sectionPageFraction, null);
    assert.equal(migrated.paginatorPage, null);
    assert.equal(migrated.paginatorPages, null);
    assert.equal(migrated.layoutMode, null);
    assert.equal(migrated.textOffset, null);
    assert.equal(migrated.textQuote, null);
    assert.equal(migrated.textSectionLength, null);
    assert.equal(migrated.positionVersion, 4);
    assert.equal(migrated.revision, 8);
    assert.equal(migrateReadingPositionToV4(USERNAME, BOOK_IDS.dbEpub).revision, 8);
  });

  it('atomically compares and increments the monotonic revision', () => {
    clearPosition(BOOK_IDS.dbCas);
    clearPosition(BOOK_IDS.dbMissing);
    const created = setReadingPositionCas(
      USERNAME, BOOK_IDS.dbCas, 0, 'epubcfi(/6/2)', 10, 0.1, null,
      { sectionIndex: 2, textOffset: 1234, textQuote: 'Exact words', textSectionLength: 9000 },
    );
    assert.equal(created.revision, 1);
    assert.equal(created.positionVersion, 4);
    assert.equal(created.textOffset, 1234);
    assert.equal(created.textQuote, 'Exact words');
    assert.equal(created.textSectionLength, 9000);

    const updated = setReadingPositionCas(
      USERNAME, BOOK_IDS.dbCas, 1, 'epubcfi(/6/4)', 20, 0.2, null,
    );
    assert.equal(updated.revision, 2);
    assert.equal(updated.position, 'epubcfi(/6/4)');

    assert.equal(
      setReadingPositionCas(USERNAME, BOOK_IDS.dbCas, 1, 'stale', 99, 0.99, null),
      null,
    );
    assert.equal(getReadingPosition(USERNAME, BOOK_IDS.dbCas).revision, 2);
    assert.equal(
      setReadingPositionCas(USERNAME, BOOK_IDS.dbCas, 0, 'duplicate-create', 1, 0.01, null),
      null,
    );
    assert.equal(
      setReadingPositionCas(USERNAME, BOOK_IDS.dbMissing, 7, 'missing', 1, 0.01, null),
      null,
    );
  });

  it('rebuildActiveBooksView resets cached position statements', async () => {
    clearPosition(BOOK_IDS.dbCas);
    setReadingPositionCas(USERNAME, BOOK_IDS.dbCas, 0, 'epubcfi(/6/2)', 10, 0.1, null);
    await rebuildActiveBooksView();
    const pos = getReadingPosition(USERNAME, BOOK_IDS.dbCas);
    assert.equal(pos.position, 'epubcfi(/6/2)');
    const updated = setReadingPositionCas(USERNAME, BOOK_IDS.dbCas, pos.revision, 'epubcfi(/6/6)', 30, 0.3, null);
    assert.equal(updated.revision, pos.revision + 1);
  });
});

describe('reading position v4 API', () => {
  let server;
  let baseUrl;

  before(async () => {
    initDb();
    if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get(USERNAME)) {
      createUser({ username: USERNAME, password: PASSWORD });
    }
    for (const [id, ext] of [
      [BOOK_IDS.apiFb2, 'fb2'],
      [BOOK_IDS.apiMissing, 'epub'],
      [BOOK_IDS.apiEpub, 'epub'],
      [BOOK_IDS.apiCas, 'epub'],
      [BOOK_IDS.apiReadState, 'epub'],
    ]) {
      if (!db.prepare('SELECT 1 FROM books WHERE id = ?').get(id)) insertBook(id, ext);
    }

    const app = express();
    app.use(express.json());
    registerReaderRoutes(app);
    app.use((error, req, res, next) => {
      void next;
      res.status(500).json({ ok: false, error: error.message });
    });
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  async function request(method, bookId, body) {
    const response = await fetch(`${baseUrl}/api/books/${bookId}/position`, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }

  it('rejects missing or old write protocol with structured HTTP 428', async () => {
    const missing = await request('POST', BOOK_IDS.apiCas, { position: '', progress: 1 });
    assert.equal(missing.status, 428);
    assert.deepEqual(
      {
        ok: missing.body.ok,
        code: missing.body.code,
        requiredPositionVersion: missing.body.requiredPositionVersion,
      },
      {
        ok: false,
        code: 'POSITION_PROTOCOL_REQUIRED',
        requiredPositionVersion: 4,
      },
    );

    const old = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 2,
      baseRevision: 0,
      position: '',
      progress: 1,
    });
    assert.equal(old.status, 428);
    assert.equal(old.body.code, 'POSITION_PROTOCOL_REQUIRED');

    const nonInteger = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: '0',
      position: '',
      progress: 1,
    });
    assert.equal(nonInteger.status, 428);
    assert.equal(nonInteger.body.code, 'POSITION_PROTOCOL_REQUIRED');
  });

  it('GET returns the empty v4 revision-zero state when no row exists', async () => {
    clearPosition(BOOK_IDS.apiMissing);
    const response = await request('GET', BOOK_IDS.apiMissing);
    assert.equal(response.status, 200);
    assert.equal(response.body.position, '');
    assert.equal(response.body.progress, 0);
    assert.equal(response.body.fraction, null);
    assert.equal(response.body.positionVersion, 4);
    assert.equal(response.body.textOffset, null);
    assert.equal(response.body.revision, 0);
  });

  it('GET lazily resets legacy FB2 and returns v4 revision idempotently', async () => {
    clearPosition(BOOK_IDS.apiFb2);
    insertLegacyPosition(BOOK_IDS.apiFb2, { positionVersion: 3 });
    const first = await request('GET', BOOK_IDS.apiFb2);
    assert.equal(first.status, 200);
    assert.equal(first.body.position, '');
    assert.equal(first.body.progress, 0);
    assert.equal(first.body.positionVersion, 4);
    assert.equal(first.body.revision, 2);

    const second = await request('GET', BOOK_IDS.apiFb2);
    assert.equal(second.status, 200);
    assert.equal(second.body.revision, 2);
  });

  it('GET preserves only CFI while upgrading an existing v3 non-FB2 row', async () => {
    clearPosition(BOOK_IDS.apiEpub);
    insertLegacyPosition(BOOK_IDS.apiEpub, {
      position: 'epubcfi(/6/8)',
      progress: 64,
      fraction: 0.64,
      positionVersion: 3,
      revision: 4,
    });
    const response = await request('GET', BOOK_IDS.apiEpub);
    assert.equal(response.status, 200);
    assert.equal(response.body.position, 'epubcfi(/6/8)');
    assert.equal(response.body.progress, 0);
    assert.equal(response.body.fraction, null);
    assert.equal(response.body.fb2Href, null);
    assert.equal(response.body.sectionIndex, null);
    assert.equal(response.body.sectionPageFraction, null);
    assert.equal(response.body.paginatorPage, null);
    assert.equal(response.body.paginatorPages, null);
    assert.equal(response.body.layoutMode, null);
    assert.equal(response.body.positionVersion, 4);
    assert.equal(response.body.revision, 5);
  });

  it('saves by CAS and returns HTTP 409 with the current payload', async () => {
    clearPosition(BOOK_IDS.apiCas);
    const created = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: null,
      position: 'epubcfi(/6/2)',
      progress: 10,
      fraction: 0.1,
      sectionIndex: 2,
      textOffset: 1234,
      textQuote: 'Exact words',
      textSectionLength: 9000,
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.positionVersion, 4);
    assert.equal(created.body.revision, 1);
    assert.equal(created.body.textOffset, 1234);
    assert.equal(created.body.textQuote, 'Exact words');
    assert.equal(created.body.textSectionLength, 9000);
    const roundtrip = await request('GET', BOOK_IDS.apiCas);
    assert.equal(roundtrip.body.sectionIndex, 2);
    assert.equal(roundtrip.body.textOffset, 1234);
    assert.equal(roundtrip.body.textQuote, 'Exact words');
    assert.equal(roundtrip.body.textSectionLength, 9000);

    const conflict = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 0,
      position: 'stale',
      progress: 99,
      fraction: 0.99,
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, 'POSITION_CONFLICT');
    assert.equal(conflict.body.current.position, 'epubcfi(/6/2)');
    assert.equal(conflict.body.current.positionVersion, 4);
    assert.equal(conflict.body.current.revision, 1);

    const updated = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 1,
      position: 'epubcfi(/6/4)',
      progress: 20,
      fraction: 0.2,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.revision, 2);
  });

  it('rejects malformed or oversized exact text anchors', async () => {
    clearPosition(BOOK_IDS.apiCas);
    const malformed = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 0,
      position: '',
      progress: 10,
      sectionIndex: 2,
      textOffset: -1,
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.code, 'VALIDATION');

    const oversized = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 0,
      position: '',
      progress: 10,
      sectionIndex: 2,
      textOffset: 12,
      textQuote: 'x'.repeat(257),
    });
    assert.equal(oversized.status, 400);
    assert.equal(oversized.body.code, 'VALIDATION');
  });

  it('falls back to progress when fraction is null or empty', async () => {
    clearPosition(BOOK_IDS.apiCas);
    const withNull = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 0,
      position: '',
      progress: 37,
      fraction: null,
    });
    assert.equal(withNull.status, 200);
    assert.equal(withNull.body.revision, 1);
    const afterNull = await request('GET', BOOK_IDS.apiCas);
    assert.equal(afterNull.body.progress, 37);
    assert.equal(afterNull.body.fraction, 0.37);

    const withEmpty = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 1,
      position: '',
      progress: 48,
      fraction: '',
    });
    assert.equal(withEmpty.status, 200);
    assert.equal(withEmpty.body.revision, 2);
    const afterEmpty = await request('GET', BOOK_IDS.apiCas);
    assert.equal(afterEmpty.body.progress, 48);
    assert.equal(afterEmpty.body.fraction, 0.48);
  });

  it('clears read status when a completed book is actively read below 95%', async () => {
    clearPosition(BOOK_IDS.apiReadState);
    db.prepare('DELETE FROM read_books WHERE username = ? AND book_id = ?')
      .run(USERNAME, BOOK_IDS.apiReadState);

    const completed = await request('POST', BOOK_IDS.apiReadState, {
      positionVersion: 4,
      baseRevision: 0,
      position: 'epubcfi(/6/20)',
      progress: 99,
      fraction: 0.99,
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.markedRead, true);
    assert.ok(db.prepare('SELECT 1 FROM read_books WHERE username = ? AND book_id = ?')
      .get(USERNAME, BOOK_IDS.apiReadState));

    const nearEnd = await request('POST', BOOK_IDS.apiReadState, {
      positionVersion: 4,
      baseRevision: 1,
      position: 'epubcfi(/6/18)',
      progress: 98,
      fraction: 0.98,
    });
    assert.equal(nearEnd.body.unmarkedRead, false);

    const restarted = await request('POST', BOOK_IDS.apiReadState, {
      positionVersion: 4,
      baseRevision: 2,
      position: 'epubcfi(/6/16)',
      progress: 85,
      fraction: 0.85,
    });
    assert.equal(restarted.status, 200);
    assert.equal(restarted.body.unmarkedRead, true);
    assert.equal(
      db.prepare('SELECT 1 FROM read_books WHERE username = ? AND book_id = ?')
        .get(USERNAME, BOOK_IDS.apiReadState),
      undefined,
    );
  });

  it('idle-steals a stale revision from another session and GET reports holder metadata', async () => {
    clearPosition(BOOK_IDS.apiCas);
    const created = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 0,
      sessionId: 'tablet-session',
      position: 'epubcfi(/6/2)',
      progress: 12,
      fraction: 0.12,
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.revision, 1);
    db.prepare(`
      UPDATE reading_positions
      SET last_user_activity_at = datetime('now', '-5 minutes')
      WHERE username = ? AND book_id = ?
    `).run(USERNAME, BOOK_IDS.apiCas);

    const stolen = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 0,
      sessionId: 'phone-session',
      position: 'epubcfi(/6/14)',
      progress: 60,
      fraction: 0.6,
    });
    assert.equal(stolen.status, 200);
    assert.equal(stolen.body.revision, 2);

    const roundtrip = await request('GET', BOOK_IDS.apiCas);
    assert.equal(roundtrip.body.sessionId, 'phone-session');
    assert.equal(roundtrip.body.sessionStatus, 'active');
    assert.equal(roundtrip.body.progress, 60);
  });

  it('rejects a stale write from another session while the holder is active', async () => {
    clearPosition(BOOK_IDS.apiCas);
    const created = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 0,
      sessionId: 'tablet-session',
      position: 'epubcfi(/6/2)',
      progress: 12,
      fraction: 0.12,
    });
    assert.equal(created.status, 200);

    const conflict = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 0,
      sessionId: 'phone-session',
      position: 'epubcfi(/6/14)',
      progress: 60,
      fraction: 0.6,
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.current.sessionId, 'tablet-session');
    assert.equal(conflict.body.current.sessionStatus, 'active');
    assert.equal(conflict.body.current.revision, 1);
  });

  it('keeps strict CAS when the client omits sessionId', async () => {
    clearPosition(BOOK_IDS.apiCas);
    const created = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 0,
      sessionId: 'tablet-session',
      position: 'epubcfi(/6/2)',
      progress: 12,
      fraction: 0.12,
    });
    assert.equal(created.status, 200);
    db.prepare(`
      UPDATE reading_positions
      SET last_user_activity_at = datetime('now', '-5 minutes')
      WHERE username = ? AND book_id = ?
    `).run(USERNAME, BOOK_IDS.apiCas);

    const conflict = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 0,
      position: 'epubcfi(/6/14)',
      progress: 60,
      fraction: 0.6,
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.current.sessionId, 'tablet-session');
  });

  it('rejects a matching-revision write from another active session', async () => {
    clearPosition(BOOK_IDS.apiCas);
    const created = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 0,
      sessionId: 'tablet-session',
      position: 'epubcfi(/6/2)',
      progress: 12,
      fraction: 0.12,
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.revision, 1);

    const conflict = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 1,
      sessionId: 'phone-session',
      position: 'epubcfi(/6/14)',
      progress: 60,
      fraction: 0.6,
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.current.sessionId, 'tablet-session');
    assert.equal(conflict.body.current.revision, 1);
  });

  it('allows a matching-revision take-over when the holder is idle', async () => {
    clearPosition(BOOK_IDS.apiCas);
    const created = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 0,
      sessionId: 'tablet-session',
      position: 'epubcfi(/6/2)',
      progress: 12,
      fraction: 0.12,
    });
    assert.equal(created.status, 200);
    db.prepare(`
      UPDATE reading_positions
      SET last_user_activity_at = datetime('now', '-5 minutes')
      WHERE username = ? AND book_id = ?
    `).run(USERNAME, BOOK_IDS.apiCas);

    const taken = await request('POST', BOOK_IDS.apiCas, {
      positionVersion: 4,
      baseRevision: 1,
      sessionId: 'phone-session',
      position: 'epubcfi(/6/14)',
      progress: 60,
      fraction: 0.6,
    });
    assert.equal(taken.status, 200);
    assert.equal(taken.body.revision, 2);
    const roundtrip = await request('GET', BOOK_IDS.apiCas);
    assert.equal(roundtrip.body.sessionId, 'phone-session');
    assert.equal(roundtrip.body.progress, 60);
  });
});
