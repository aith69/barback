import test from 'node:test';
import assert from 'node:assert/strict';
import { call, makeApp } from './helpers.js';

test('the counter queue tells which lines were served, so served tables can be hidden', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const post = async (url, body) => (await call(app, 'POST', url, body)).body;
  const marco = await post('/api/admin/operators', { name: 'Marco' });
  const coffee = await post('/api/admin/categories', { name: 'Coffee' });
  const espresso = await post('/api/admin/items', { category_id: coffee.id, name: 'Espresso', price_cents: 120 });
  await call(app, 'POST', '/api/tables/1/lines', { operator_id: marco.id, lines: [{ item_id: espresso.id, quantity: 1 }] });
  const servedAt = async () => (await call(app, 'GET', '/api/counter/queue')).body[0].lines[0].served_at;

  assert.equal(await servedAt(), null);
  await call(app, 'POST', '/api/counter/tables/1/prepared', { prepared: true });
  assert.equal(await servedAt(), null); // prepared, not served yet
  assert.equal((await call(app, 'POST', '/api/tables/1/served', { served: true })).status, 204);
  assert.ok(await servedAt());
  await call(app, 'POST', '/api/tables/1/served', { served: false });
  assert.equal(await servedAt(), null);
});
