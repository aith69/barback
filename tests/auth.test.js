import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { defaults } from '../server/config.js';

const make = (extra = {}) => buildApp({ ...defaults, dbPath: ':memory:', sharedPin: '4321', ...extra });
const send = (app, method, url, { payload, cookie } = {}) =>
  app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });

async function login(app, pin = '4321') {
  const res = await send(app, 'POST', '/api/auth/login', { payload: { pin } });
  const raw = res.headers['set-cookie'];
  return { res, cookie: raw ? String(raw).split(';')[0] : null };
}

test('admin, cash and stats need the PIN; the rest stays open', async (t) => {
  const app = await make();
  t.after(() => app.close());

  const locked = [
    ['GET', '/api/admin/menu'],
    ['GET', '/api/admin/operators'],
    ['POST', '/api/admin/operators', { name: 'X' }],
    ['PATCH', '/api/admin/items/1', { name: 'X' }],
    ['DELETE', '/api/admin/items/1'],
    ['GET', '/api/counter/tables'],
    ['POST', '/api/counter/tables/1/close', { operator_id: 1, total_paid_cents: 0 }],
  ];
  for (const [method, url, payload] of locked) {
    assert.equal((await send(app, method, url, { payload })).statusCode, 401, `${method} ${url}`);
  }

  for (const url of ['/api/menu', '/api/operators', '/api/tables', '/api/counter/queue', '/api/config', '/api/health']) {
    assert.equal((await send(app, 'GET', url)).statusCode, 200, url);
  }
  // open routes are reached (and answer for themselves), never blocked with 401
  const status = async (method, url, payload) => (await send(app, method, url, { payload })).statusCode;
  assert.equal(await status('PUT', '/api/counter/lines/1/status', { status: 'new' }), 404);
  assert.equal(await status('POST', '/api/counter/tables/1/prepared', { prepared: true }), 404);
  assert.equal(await status('POST', '/api/tables/1/lines', { operator_id: 99, lines: [{ item_id: 1, quantity: 1 }] }), 400);
});

test('login gives a session cookie that unlocks, logout takes it away', async (t) => {
  const app = await make();
  t.after(() => app.close());

  const wrong = await login(app, '0000');
  assert.equal(wrong.res.statusCode, 401);
  assert.equal(wrong.cookie, null);

  const { res, cookie } = await login(app);
  assert.equal(res.statusCode, 204);
  const header = String(res.headers['set-cookie']);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.doesNotMatch(header, /Max-Age/); // gone when the browser closes

  assert.equal((await send(app, 'GET', '/api/auth/status')).json().authenticated, false);
  assert.equal((await send(app, 'GET', '/api/auth/status', { cookie })).json().authenticated, true);
  assert.equal((await send(app, 'GET', '/api/admin/menu', { cookie })).statusCode, 200);

  assert.equal((await send(app, 'POST', '/api/auth/logout', { cookie })).statusCode, 204);
  assert.equal((await send(app, 'GET', '/api/admin/menu', { cookie })).statusCode, 401);
});

test('sessions expire after pinSessionHours', async (t) => {
  const app = await make({ pinSessionHours: 0 });
  t.after(() => app.close());
  const { cookie } = await login(app);
  assert.ok(cookie);
  assert.equal((await send(app, 'GET', '/api/admin/menu', { cookie })).statusCode, 401);
  assert.equal((await send(app, 'GET', '/api/auth/status', { cookie })).json().authenticated, false);
});

test('five wrong PINs lock the device for a while', async (t) => {
  const app = await make();
  t.after(() => app.close());
  for (let i = 0; i < 5; i += 1) assert.equal((await login(app, '0000')).res.statusCode, 401);
  assert.equal((await login(app, '4321')).res.statusCode, 429); // even the right one is refused now
});

test('an empty sharedPin turns the PIN off', async (t) => {
  const app = await make({ sharedPin: '' });
  t.after(() => app.close());
  assert.equal((await send(app, 'GET', '/api/admin/menu')).statusCode, 200);
  assert.equal((await send(app, 'GET', '/api/auth/status')).json().authenticated, true);
});

test('forged cookies and encoded paths do not get in', async (t) => {
  const app = await make();
  t.after(() => app.close());
  assert.equal((await send(app, 'GET', '/api/admin/menu', { cookie: 'barback_session=forged' })).statusCode, 401);
  assert.notEqual((await send(app, 'GET', '/api/%61dmin/menu')).statusCode, 200);
  assert.notEqual((await send(app, 'GET', '/api//admin/menu')).statusCode, 200);
});

test('logging in does not make every open page refresh', async (t) => {
  const app = await make();
  t.after(() => app.close());
  const seen = [];
  app.events.on('change', (e) => seen.push(e));
  await login(app);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(seen.length, 0);
});
