import test from 'node:test';
import assert from 'node:assert/strict';

// Бьём лимитер в лоб > BROWSE_MAX_HITS раз и проверяем, что health/диагностика
// не получают 429.
const { browseLimiter } = await import('../src/middleware/rate-limiter-browse.js');

function makeReq(path, ip = '203.0.113.1') {
  return { path, ip, headers: {}, get() { return undefined; } };
}
function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    set(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(_body) { this.body = _body; return this; }
  };
}

test('browseLimiter: /health освобождён от лимита', () => {
  for (let i = 0; i < 500; i++) {
    const res = makeRes();
    let nextCalled = false;
    browseLimiter(makeReq('/health'), res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, `/health отказано на итерации ${i}`);
    assert.equal(res.statusCode, 200);
  }
});

test('browseLimiter: /api/index-status и /ready освобождены', () => {
  for (const path of ['/api/index-status', '/ready', '/health/perf']) {
    for (let i = 0; i < 500; i++) {
      const res = makeRes();
      let nextCalled = false;
      browseLimiter(makeReq(path), res, () => { nextCalled = true; });
      assert.equal(nextCalled, true, `${path} отказано на итерации ${i}`);
    }
  }
});

test('browseLimiter: обычные пути всё ещё ограничиваются', () => {
  let nexts = 0;
  let blocked = 0;
  for (let i = 0; i < 500; i++) {
    const res = makeRes();
    browseLimiter(makeReq('/catalog', '198.51.100.7'), res, () => { nexts++; });
    if (res.statusCode === 429) blocked++;
  }
  assert.ok(blocked > 0, 'ожидаем хотя бы один 429 на /catalog');
  assert.ok(nexts > 0 && nexts < 500, 'часть запросов должна пройти, часть — нет');
});

test('browseLimiter: обложки и портрет не расходуют лимит', () => {
  const ip = '198.51.100.9';
  for (let i = 0; i < 400; i++) {
    const res = makeRes();
    let nextCalled = false;
    browseLimiter(makeReq(`/api/books/book${i}/cover-thumb`, ip), res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  }
  const portrait = makeRes();
  let portraitNext = false;
  browseLimiter(makeReq('/api/authors/portrait', ip), portrait, () => { portraitNext = true; });
  assert.equal(portraitNext, true);

  // Search still limited for this IP after cover flood
  let nexts = 0;
  let blocked = 0;
  for (let i = 0; i < 500; i++) {
    const res = makeRes();
    browseLimiter(makeReq('/api/catalog', ip), res, () => { nexts++; });
    if (res.statusCode === 429) blocked++;
  }
  assert.ok(blocked > 0, 'поиск всё ещё под лимитом');
  assert.ok(nexts > 0, 'часть поисковых запросов проходит');
});

test('browseLimiter: авторизованный клиент имеет больший лимит', () => {
  const anonIp = '198.51.100.21';
  const authIp = '198.51.100.22';
  let anonOk = 0;
  let authOk = 0;
  for (let i = 0; i < 500; i++) {
    const anonRes = makeRes();
    browseLimiter(makeReq('/api/catalog', anonIp), anonRes, () => { anonOk++; });
    const authReq = makeReq('/api/catalog', authIp);
    authReq.headers = { authorization: 'Bearer test-token' };
    authReq.get = (name) => (String(name).toLowerCase() === 'authorization' ? 'Bearer test-token' : undefined);
    const authRes = makeRes();
    browseLimiter(authReq, authRes, () => { authOk++; });
  }
  assert.ok(authOk > anonOk, `auth (${authOk}) должен пропускать больше, чем anon (${anonOk})`);
});
