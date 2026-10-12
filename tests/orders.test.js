import test from 'node:test';
import assert from 'node:assert/strict';
import { call, makeApp } from './helpers.js';

async function seed(app) {
  const post = async (url, body) => (await call(app, 'POST', url, body)).body;
  const marco = await post('/api/admin/operators', { name: 'Marco' });
  const giulia = await post('/api/admin/operators', { name: 'Giulia' });
  const coffee = await post('/api/admin/categories', { name: 'Coffee' });
  const espresso = await post('/api/admin/items', { category_id: coffee.id, name: 'Espresso', price_cents: 120 });
  const cappuccino = await post('/api/admin/items', { category_id: coffee.id, name: 'Cappuccino', price_cents: 150 });
  const decaf = await post('/api/admin/modifiers', { category_id: coffee.id, name: 'Decaf' });
  const hot = await post('/api/admin/modifiers', { item_id: cappuccino.id, name: 'Extra hot' });
  return { marco, giulia, coffee, espresso, cappuccino, decaf, hot };
}

const add = (app, table, operator, lines) =>
  call(app, 'POST', `/api/tables/${table}/lines`, { operator_id: operator.id, lines });

test('catalog: active operators and the menu with inherited quick notes', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  await call(app, 'PATCH', `/api/admin/operators/${s.giulia.id}`, { active: false });
  const hidden = await call(app, 'POST', '/api/admin/items', { category_id: s.coffee.id, name: 'Hidden', price_cents: 100 });
  await call(app, 'PATCH', `/api/admin/items/${hidden.body.id}`, { active: false });
  await call(app, 'PATCH', `/api/admin/items/${s.espresso.id}`, { sold_out: true });

  const ops = (await call(app, 'GET', '/api/operators')).body;
  assert.deepEqual(ops.map((o) => o.name), ['Marco']);

  const { categories } = (await call(app, 'GET', '/api/menu')).body;
  assert.equal(categories.length, 1);
  const items = categories[0].items;
  assert.deepEqual(items.map((i) => i.name), ['Espresso', 'Cappuccino']);
  assert.equal(items[0].sold_out, true);
  assert.deepEqual(items[0].modifiers.map((m) => m.name), ['Decaf']);
  assert.deepEqual(items[1].modifiers.map((m) => m.name), ['Decaf', 'Extra hot']);
});

test('tables are free until an order is placed', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);

  const grid = (await call(app, 'GET', '/api/tables')).body;
  assert.equal(grid.length, 20);
  assert.ok(grid.every((x) => !x.occupied));

  const res = await add(app, 5, s.marco, [{ item_id: s.espresso.id, quantity: 2 }]);
  assert.equal(res.status, 201);
  const after = (await call(app, 'GET', '/api/tables')).body;
  const five = after.find((x) => x.number === 5);
  assert.equal(five.occupied, true);
  assert.equal(five.pending, 1);
  assert.equal(after.filter((x) => x.occupied).length, 1);
});

test('lines snapshot name, price, notes and quick notes', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);

  const res = await add(app, 3, s.marco, [
    { item_id: s.cappuccino.id, quantity: 2, note: '  very foamy ', modifier_ids: [s.decaf.id, s.hot.id] },
    { item_id: s.espresso.id, quantity: 1 },
  ]);
  const order = res.body.order;
  assert.equal(res.body.number, 3);
  assert.equal(order.lines.length, 2);
  assert.equal(order.subtotal_cents, 2 * 150 + 120);
  const cap = order.lines[0];
  assert.equal(cap.note, 'very foamy');
  assert.equal(cap.created_by, 'Marco');
  assert.equal(cap.status, 'new');
  assert.deepEqual(cap.modifiers.map((m) => m.name).sort(), ['Decaf', 'Extra hot']);

  // a second round, even by another waiter, goes into the same order
  const second = await add(app, 3, s.giulia, [{ item_id: s.espresso.id, quantity: 1 }]);
  assert.equal(second.body.order.id, order.id);
  assert.equal(second.body.order.lines.length, 3);

  // later changes in the menu do not touch existing lines
  await call(app, 'PATCH', `/api/admin/items/${s.espresso.id}`, { price_cents: 200, name: 'Espresso!' });
  const again = (await call(app, 'GET', '/api/tables/3')).body.order;
  assert.equal(again.lines[1].unit_price_cents, 120);
  assert.equal(again.lines[1].item_name, 'Espresso');
  assert.equal(again.subtotal_cents, 2 * 150 + 120 + 120);
});

test('validation: operator, item, stock, quick notes, table range, atomic batches', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  const ok = { item_id: s.espresso.id, quantity: 1 };

  assert.equal((await call(app, 'POST', '/api/tables/1/lines', { operator_id: 999, lines: [ok] })).status, 400);
  assert.equal((await add(app, 1, s.marco, [{ item_id: 999, quantity: 1 }])).status, 400);
  assert.equal((await add(app, 1, s.marco, [{ ...ok, quantity: 0 }])).status, 400);
  assert.equal((await add(app, 1, s.marco, [{ ...ok, modifier_ids: [s.hot.id] }])).status, 400); // only for cappuccino
  assert.equal((await add(app, 1, s.marco, [])).status, 400);
  assert.equal((await add(app, 0, s.marco, [ok])).status, 404);
  assert.equal((await add(app, 21, s.marco, [ok])).status, 404);
  assert.equal((await call(app, 'GET', '/api/tables/21')).status, 404);

  // one bad line rejects the whole batch: no order is created
  assert.equal((await add(app, 2, s.marco, [ok, { item_id: 999, quantity: 1 }])).status, 400);
  assert.equal((await call(app, 'GET', '/api/tables/2')).body.order, null);

  await call(app, 'PATCH', `/api/admin/items/${s.espresso.id}`, { sold_out: true });
  assert.equal((await add(app, 1, s.marco, [ok])).status, 409);
});

test('lines can be edited and removed (soft delete)', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);

  const res = await add(app, 4, s.marco, [
    { item_id: s.cappuccino.id, quantity: 1, modifier_ids: [s.decaf.id] },
    { item_id: s.espresso.id, quantity: 1 },
  ]);
  const [cap, esp] = res.body.order.lines;

  const edit = await call(app, 'PATCH', `/api/lines/${cap.id}`, {
    operator_id: s.giulia.id, quantity: 3, note: '', modifier_ids: [s.hot.id],
  });
  assert.equal(edit.status, 200);
  const edited = edit.body.order.lines.find((l) => l.id === cap.id);
  assert.equal(edited.quantity, 3);
  assert.equal(edited.note, null);
  assert.deepEqual(edited.modifiers.map((m) => m.name), ['Extra hot']);
  assert.equal(edit.body.order.subtotal_cents, 3 * 150 + 120);

  const del = await call(app, 'DELETE', `/api/lines/${esp.id}?operator_id=${s.giulia.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.order.lines.length, 1);
  assert.equal(del.body.order.subtotal_cents, 450);
  const row = app.db.prepare('SELECT removed_at, removed_by FROM order_lines WHERE id = ?').get(esp.id);
  assert.ok(row.removed_at);
  assert.equal(row.removed_by, s.giulia.id);

  assert.equal((await call(app, 'DELETE', `/api/lines/${esp.id}?operator_id=${s.giulia.id}`)).status, 404);
  const badNote = await call(app, 'PATCH', `/api/lines/${cap.id}`, { operator_id: s.giulia.id, modifier_ids: [999] });
  assert.equal(badNote.status, 400);
});

test('a closed order frees the table and cannot be edited', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  const ok = { item_id: s.espresso.id, quantity: 1 };

  const first = await add(app, 6, s.marco, [ok]);
  const line = first.body.order.lines[0];
  app.db.prepare("UPDATE orders SET status = 'closed', closed_at = datetime('now') WHERE id = ?").run(first.body.order.id);

  assert.equal((await call(app, 'GET', '/api/tables/6')).body.order, null);
  const grid = (await call(app, 'GET', '/api/tables')).body;
  assert.equal(grid.find((x) => x.number === 6).occupied, false);
  assert.equal((await call(app, 'PATCH', `/api/lines/${line.id}`, { operator_id: s.marco.id, quantity: 2 })).status, 409);

  const fresh = await add(app, 6, s.marco, [ok]);
  assert.notEqual(fresh.body.order.id, first.body.order.id);
});
