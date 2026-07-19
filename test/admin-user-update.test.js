import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const {
  initDb, createUser, deleteUser, updateUser, getUserByUsername,
  setUserTelegramId, setUserEreaderEmail, getEreaderEmail,
} = await import('../src/db.js');
const { isAdminUserScopedFieldsReady } = await import('../src/routes/admin.js');
const { attachSessionUser, invalidateSessionUserCache } = await import('../src/middleware/auth.js');
const { createSessionValue } = await import('../src/services/session.js');

initDb();

const USERNAME = 'adminuserupdatetest';
const PASSWORD = 'Sup3rSecretPass1';
const TG_ID = '123456789';
const EMAIL = 'reader@example.com';

function fakeReq({ cookies = {}, body = {} } = {}) {
  return { cookies, body, get: () => undefined };
}

function scopedField(base) {
  return `${base}__${USERNAME.replace(/[^\w.-]/g, '_')}`;
}

before(() => {
  try { deleteUser(USERNAME); } catch { /* ignore */ }
  createUser({ username: USERNAME, password: PASSWORD, role: 'user' });
  setUserTelegramId(USERNAME, TG_ID);
  setUserEreaderEmail(USERNAME, EMAIL);
});

after(() => {
  try { deleteUser(USERNAME); } catch { /* ignore */ }
});

test('isAdminUserScopedFieldsReady is false without hydration flag', () => {
  const body = { [scopedField('accountTelegramId')]: '' };
  assert.equal(isAdminUserScopedFieldsReady(body, USERNAME), false);
});

test('isAdminUserScopedFieldsReady is true after hydration flag is set', () => {
  const body = { [scopedField('accountFieldsReady')]: '1' };
  assert.equal(isAdminUserScopedFieldsReady(body, USERNAME), true);
});

test('admin update without hydration must not clear telegram or ereader email', () => {
  const body = {
    accountUsername: USERNAME,
    role: 'user',
    [scopedField('accountTelegramId')]: '',
    [scopedField('accountEreaderEmail')]: '',
  };
  assert.equal(isAdminUserScopedFieldsReady(body, USERNAME), false);

  updateUser({ username: USERNAME, role: 'user' });
  if (isAdminUserScopedFieldsReady(body, USERNAME)) {
    setUserTelegramId(USERNAME, body[scopedField('accountTelegramId')]);
    setUserEreaderEmail(USERNAME, body[scopedField('accountEreaderEmail')]);
  }

  const user = getUserByUsername(USERNAME);
  assert.equal(String(user.telegramId ?? ''), TG_ID);
  assert.equal(getEreaderEmail(USERNAME), EMAIL);
});

test('admin update with hydration may clear telegram when field emptied intentionally', () => {
  const body = {
    accountUsername: USERNAME,
    role: 'user',
    [scopedField('accountFieldsReady')]: '1',
    [scopedField('accountTelegramId')]: '',
    [scopedField('accountEreaderEmail')]: EMAIL,
  };
  assert.equal(isAdminUserScopedFieldsReady(body, USERNAME), true);

  if (isAdminUserScopedFieldsReady(body, USERNAME)) {
    if (body[scopedField('accountTelegramId')] !== TG_ID) {
      setUserTelegramId(USERNAME, body[scopedField('accountTelegramId')]);
    }
  }

  const user = getUserByUsername(USERNAME);
  assert.equal(user.telegramId ?? '', '');
  setUserTelegramId(USERNAME, TG_ID);
});

test('invalidateSessionUserCache refreshes cached role after admin demotion', () => {
  updateUser({ username: USERNAME, role: 'admin' });
  const user = getUserByUsername(USERNAME);
  assert.equal(user.role, 'admin');

  const sessionGen = user.sessionGen || 0;
  const req = fakeReq({ cookies: { session: createSessionValue(USERNAME, sessionGen) } });
  attachSessionUser(req, {}, () => {});
  assert.equal(req.user?.role, 'admin');

  updateUser({ username: USERNAME, role: 'user' });
  attachSessionUser(req, {}, () => {});
  assert.equal(req.user?.role, 'admin', 'stale cache keeps old role');

  invalidateSessionUserCache(USERNAME);
  attachSessionUser(req, {}, () => {});
  assert.equal(req.user?.role, 'user');

  updateUser({ username: USERNAME, role: 'user' });
});
