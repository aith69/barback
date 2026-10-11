import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { defaults } from '../server/config.js';

const make = (extra = {}) => buildApp({ ...defaults, dbPath: ':memory:', ...extra });

test('health endpoint', async () => {
  const app = await make();
  const res = await app.inject('/api/health');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok' });
  await app.close();
});

test('UI language comes from the config, not from the browser', async () => {
  const app = await make({ language: 'it' });
  const res = await app.inject({ url: '/api/i18n', headers: { 'accept-language': 'en-US' } });
  assert.equal(res.json().language, 'it');
  assert.equal(res.json().messages['table.free'], 'Libero');
  await app.close();
});

test('unknown language falls back to English', async () => {
  const app = await make({ language: 'xx' });
  assert.equal((await app.inject('/api/i18n')).json().language, 'en');
  await app.close();
});

test('public config exposes only safe values', async () => {
  const app = await make();
  const cfg = (await app.inject('/api/config')).json();
  assert.equal(cfg.maxTables, 20);
  assert.equal('sharedPin' in cfg, false);
  await app.close();
});

test('frontend home page is served', async () => {
  const app = await make();
  const res = await app.inject('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Barback/);
  await app.close();
});
