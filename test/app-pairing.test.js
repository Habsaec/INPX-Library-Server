import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createUser, db, initDb } from '../src/db.js';
import { registerUserApiRoutes } from '../src/routes/user-api.js';

const USERNAME = 'pairing_user';
const PASSWORD = 'PairingPass1!';

describe('app pairing API', () => {
  let server;
  let baseUrl;

  before(async () => {
    initDb();
    if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get(USERNAME)) {
      createUser({ username: USERNAME, password: PASSWORD });
    }
    db.prepare('DELETE FROM app_pairing_tokens WHERE username = ?').run(USERNAME);

    const app = express();
    app.use(express.json());
    registerUserApiRoutes(app, { batchEmailLocks: new Map() });
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

  function authHeader() {
    return `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`;
  }

  it('creates a pairing payload and redeems it once into a device token', async () => {
    const createRes = await fetch(`${baseUrl}/api/auth/pairing`, {
      method: 'POST',
      headers: {
        authorization: authHeader(),
        'content-type': 'application/json',
        host: 'library.test:3000',
      },
      body: '{}',
    });
    assert.equal(createRes.status, 200);
    const created = await createRes.json();
    assert.equal(created.ok, true);
    assert.equal(created.username, USERNAME);
    assert.ok(created.code);
    assert.ok(created.expiresAt);
    assert.ok(created.payload);
    assert.ok(String(created.svg).includes('<svg'));
    const payload = JSON.parse(created.payload);
    assert.equal(payload.type, 'inpx-pair');
    assert.equal(payload.v, 1);
    assert.equal(payload.code, created.code);
    assert.equal(payload.user, USERNAME);

    const redeemRes = await fetch(`${baseUrl}/api/auth/pairing/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: created.code, deviceName: 'Test Phone' }),
    });
    assert.equal(redeemRes.status, 200);
    const redeemed = await redeemRes.json();
    assert.equal(redeemed.ok, true);
    assert.equal(redeemed.username, USERNAME);
    assert.ok(redeemed.deviceToken);
    assert.ok(redeemed.deviceTokenId);
    assert.equal(redeemed.deviceName, 'Test Phone');

    const probe = await fetch(`${baseUrl}/api/auth/pairing`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${redeemed.deviceToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(probe.status, 200);
    const probeBody = await probe.json();
    assert.equal(probeBody.ok, true);

    const second = await fetch(`${baseUrl}/api/auth/pairing/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: created.code }),
    });
    assert.equal(second.status, 400);
    const secondBody = await second.json();
    assert.equal(secondBody.code, 'PAIRING_INVALID');
  });

  it('rejects invalid pairing codes', async () => {
    const res = await fetch(`${baseUrl}/api/auth/pairing/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'not-a-real-code' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, 'PAIRING_INVALID');
  });
});
