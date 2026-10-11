import test from 'node:test';
import assert from 'node:assert/strict';
import { call, makeApp } from './helpers.js';

async function seed(app) {
  const post = async (url, body) => (await call(app, 'POST', url, body)).body;
  const marco = await post('/api/admin/operators', { name: 'Marco' });
  const coffee = await post('/api/admin/categories', { name: 'Coffee' });
  const espresso = await post('/api/admin/items', { category_id: coffee.id, name: 'Espresso', price_cents: 120 });
  const cappuccino = await post('/api/admin/items', { category_id: coffee.id, name: 'Cappuccino', price_cents: 150 });
  return { marco, espresso, cappuccino };
}

const order = (app, s, table, lines) =>
  call(app, 'POST', `/api/tables/${table}/lines`, { operator_id: s.marco.id, lines });
const row = async (app, table) => (await call(app, 'GET', '/api/tables')).body.find((x) => x.number === table);
const prepareAll = (app, table) => call(app, 'POST', `/api/counter/tables/${table}/prepared`, { prepared: true });
const served = (app, table, value) => call(app, 'POST', `/api/tables/${table}/served`, { served: value });

test('served removes a table from "to serve" but keeps it open; a new round starts fresh', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  await order(app, s, 3, [{ item_id: s.espresso.id, quantity: 1 }, { item_id: s.cappuccino.id, quantity: 1 }]);

  assert.equal((await row(app, 3)).to_serve, 0); // nothing prepared yet
  await prepareAll(app, 3);
  assert.equal((await row(app, 3)).to_serve, 2);

  assert.equal((await served(app, 3, true)).status, 204);
  const afterServe = await row(app, 3);
  assert.deepEqual([afterServe.occupied, afterServe.to_serve, afterServe.prepared], [true, 0, 2]);
  const lines = (await call(app, 'GET', '/api/tables/3')).body.order.lines;
  assert.ok(lines.every((l) => l.served_at));

  // second round: only the new line waits to be prepared, then served
  await order(app, s, 3, [{ item_id: s.espresso.id, quantity: 2 }]);
  const pending = await row(app, 3);
  assert.deepEqual([pending.pending, pending.to_serve], [1, 0]);
  await prepareAll(app, 3);
  assert.equal((await row(app, 3)).to_serve, 1);

  // undo brings back every prepared line
  assert.equal((await served(app, 3, false)).status, 204);
  assert.equal((await row(app, 3)).to_serve, 3);

  assert.equal((await served(app, 9, true)).status, 404); // no open order
  assert.equal((await call(app, 'POST', '/api/tables/3/served', {})).status, 400);
});

test('putting a line back to "to prepare" clears its served mark', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  const placed = await order(app, s, 4, [{ item_id: s.espresso.id, quantity: 1 }]);
  const line = placed.body.order.lines[0];
  await prepareAll(app, 4);
  await served(app, 4, true);

  await call(app, 'PUT', `/api/counter/lines/${line.id}/status`, { status: 'new' });
  const after = (await call(app, 'GET', '/api/tables/4')).body.order.lines[0];
  assert.equal(after.status, 'new');
  assert.equal(after.served_at, null);

  await call(app, 'PUT', `/api/counter/lines/${line.id}/status`, { status: 'prepared' });
  assert.equal((await row(app, 4)).to_serve, 1); // ready to serve again
});
