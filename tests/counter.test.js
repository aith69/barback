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
const gridRow = async (app, table) => (await call(app, 'GET', '/api/tables')).body.find((x) => x.number === table);

test('queue shows open tables; lines can be marked prepared and reverted', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  const a = await order(app, s, 2, [{ item_id: s.espresso.id, quantity: 2 }, { item_id: s.cappuccino.id, quantity: 1 }]);
  await order(app, s, 1, [{ item_id: s.espresso.id, quantity: 1 }]);

  const queue = (await call(app, 'GET', '/api/counter/queue')).body;
  assert.deepEqual(queue.map((x) => x.table), [1, 2]);
  assert.equal(queue[1].lines.length, 2);
  assert.equal(queue[1].lines[0].status, 'new');

  const first = a.body.order.lines[0];
  const setStatus = (id, status) => call(app, 'PUT', `/api/counter/lines/${id}/status`, { status });
  assert.equal((await setStatus(first.id, 'prepared')).status, 204);
  let row = await gridRow(app, 2);
  assert.deepEqual([row.pending, row.prepared], [1, 1]);
  assert.equal((await setStatus(first.id, 'new')).status, 204);
  row = await gridRow(app, 2);
  assert.deepEqual([row.pending, row.prepared], [2, 0]);

  assert.equal((await setStatus(first.id, 'nope')).status, 400);
  assert.equal((await setStatus(999, 'prepared')).status, 404);
});

test('a whole table can be marked prepared, and undone', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  await order(app, s, 3, [{ item_id: s.espresso.id, quantity: 1 }, { item_id: s.cappuccino.id, quantity: 1 }]);
  const prepare = (table, prepared) => call(app, 'POST', `/api/counter/tables/${table}/prepared`, { prepared });

  assert.equal((await prepare(3, true)).status, 204);
  let row = await gridRow(app, 3);
  assert.deepEqual([row.pending, row.prepared], [0, 2]);
  assert.equal((await prepare(3, false)).status, 204);
  row = await gridRow(app, 3);
  assert.deepEqual([row.pending, row.prepared], [2, 0]);

  assert.equal((await prepare(9, true)).status, 404); // no open order there
  assert.equal((await call(app, 'POST', '/api/counter/tables/3/prepared', {})).status, 400);
});

test('cash: open tables with their totals', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  await order(app, s, 4, [{ item_id: s.espresso.id, quantity: 3 }]);
  await order(app, s, 2, [{ item_id: s.cappuccino.id, quantity: 1 }]);

  const list = (await call(app, 'GET', '/api/counter/tables')).body;
  assert.deepEqual(list.map((x) => [x.number, x.subtotal_cents, x.lines, x.pending]), [[2, 150, 1, 1], [4, 360, 1, 1]]);
});

test('closing a table records what was actually paid and frees the table', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  const placed = await order(app, s, 5, [{ item_id: s.espresso.id, quantity: 3 }]);
  assert.equal(placed.body.order.subtotal_cents, 360);
  const close = (table, payload) => call(app, 'POST', `/api/counter/tables/${table}/close`, payload);

  assert.equal((await close(5, { operator_id: 999, total_paid_cents: 360 })).status, 400);
  assert.equal((await close(5, { operator_id: s.marco.id, total_paid_cents: -1 })).status, 400);
  assert.equal((await close(5, { operator_id: s.marco.id })).status, 400);

  const done = await close(5, { operator_id: s.marco.id, total_paid_cents: 350 });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, {
    number: 5, order_id: placed.body.order.id, subtotal_cents: 360, adjustment_cents: -10, total_paid_cents: 350,
  });
  const row = app.db.prepare('SELECT * FROM orders WHERE id = ?').get(placed.body.order.id);
  assert.equal(row.status, 'closed');
  assert.equal(row.closed_by, s.marco.id);
  assert.ok(row.closed_at);
  assert.deepEqual([row.subtotal_cents, row.adjustment_cents, row.total_paid_cents], [360, -10, 350]);

  // the table is free again, the lines stay in the history
  assert.equal((await call(app, 'GET', '/api/tables/5')).body.order, null);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM order_lines WHERE order_id = ?').get(row.id).n, 1);
  assert.equal((await call(app, 'GET', '/api/counter/queue')).body.length, 0);
  assert.equal((await close(5, { operator_id: s.marco.id, total_paid_cents: 350 })).status, 404);

  // rounding up is an adjustment too
  await order(app, s, 6, [{ item_id: s.espresso.id, quantity: 3 }]);
  assert.equal((await close(6, { operator_id: s.marco.id, total_paid_cents: 400 })).body.adjustment_cents, 40);

  // a table whose lines were all removed can still be closed
  const emptied = await order(app, s, 7, [{ item_id: s.espresso.id, quantity: 1 }]);
  await call(app, 'DELETE', `/api/lines/${emptied.body.order.lines[0].id}?operator_id=${s.marco.id}`);
  const zero = await close(7, { operator_id: s.marco.id, total_paid_cents: 0 });
  assert.equal(zero.status, 200);
  assert.equal(zero.body.adjustment_cents, 0);
});

test('successful changes are broadcast, reads and failures are not', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const seen = [];
  app.events.on('change', (e) => seen.push(e));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  await call(app, 'GET', '/api/menu');
  await call(app, 'POST', '/api/admin/operators', { name: '' }); // rejected
  await settle();
  assert.equal(seen.length, 0);

  await call(app, 'POST', '/api/admin/operators', { name: 'Marco' });
  await settle();
  assert.equal(seen.length, 1);
});

test('the event stream delivers changes to connected clients', { timeout: 10000 }, async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const abort = new AbortController();

  const res = await fetch(`${url}/api/events`, { signal: abort.signal });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  await reader.read(); // the initial "retry" line

  await fetch(`${url}/api/admin/operators`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Zed' }),
  });
  const { value } = await reader.read();
  assert.match(new TextDecoder().decode(value), /^data: /);
  abort.abort();
});
