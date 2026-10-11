import test from 'node:test';
import assert from 'node:assert/strict';
import { call, makeApp } from './helpers.js';

async function seed(app) {
  const post = async (url, body) => (await call(app, 'POST', url, body)).body;
  const marco = await post('/api/admin/operators', { name: 'Marco' });
  const coffee = await post('/api/admin/categories', { name: 'Coffee' });
  const espresso = await post('/api/admin/items', { category_id: coffee.id, name: 'Espresso', price_cents: 120 });
  const decaf = await post('/api/admin/modifiers', { category_id: coffee.id, name: 'Decaf' });
  const hot = await post('/api/admin/modifiers', { item_id: espresso.id, name: 'Extra hot' });
  return { marco, coffee, espresso, decaf, hot };
}

const order = (app, s) =>
  call(app, 'POST', '/api/tables/1/lines', {
    operator_id: s.marco.id,
    lines: [{ item_id: s.espresso.id, quantity: 1, modifier_ids: [s.hot.id] }],
  });
const adminMenu = async (app) => (await call(app, 'GET', '/api/admin/menu')).body;
const del = (app, path) => call(app, 'DELETE', path);

test('deleting an item removes it from every list but not from past orders', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  const line = (await order(app, s)).body.order.lines[0];

  assert.equal((await del(app, `/api/admin/items/${s.espresso.id}`)).status, 204);
  const menu = await adminMenu(app);
  assert.equal(menu.items.length, 0);
  assert.deepEqual(menu.modifiers.map((m) => m.name), ['Decaf']); // its own note went, the category note stays
  assert.equal((await call(app, 'GET', '/api/menu')).body.categories[0].items.length, 0);
  assert.equal((await order(app, s)).status, 400);

  const onTable = (await call(app, 'GET', '/api/tables/1')).body.order;
  assert.equal(onTable.lines[0].item_name, 'Espresso');
  assert.deepEqual(onTable.lines[0].modifiers.map((m) => m.name), ['Extra hot']);
  const edit = await call(app, 'PATCH', `/api/lines/${line.id}`, { operator_id: s.marco.id, quantity: 2 });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.order.subtotal_cents, 240);

  assert.equal((await del(app, `/api/admin/items/${s.espresso.id}`)).status, 404);
});

test('deleting a category takes its items and notes along, not other categories', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  const drinks = (await call(app, 'POST', '/api/admin/categories', { name: 'Drinks' })).body;
  await call(app, 'POST', '/api/admin/items', { category_id: drinks.id, name: 'Water', price_cents: 100 });

  assert.equal((await del(app, `/api/admin/categories/${s.coffee.id}`)).status, 204);
  const menu = await adminMenu(app);
  assert.deepEqual(menu.categories.map((c) => c.name), ['Drinks']);
  assert.deepEqual(menu.items.map((i) => i.name), ['Water']);
  assert.equal(menu.modifiers.length, 0);
  const waiter = (await call(app, 'GET', '/api/menu')).body;
  assert.deepEqual(waiter.categories.map((c) => c.name), ['Drinks']);
  assert.equal((await del(app, `/api/admin/categories/${s.coffee.id}`)).status, 404);
});

test('deleting an operator keeps their history, and the same name brings them back', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  await order(app, s);

  assert.equal((await del(app, `/api/admin/operators/${s.marco.id}`)).status, 204);
  assert.deepEqual((await call(app, 'GET', '/api/admin/operators')).body, []);
  assert.deepEqual((await call(app, 'GET', '/api/operators')).body, []);
  assert.equal((await order(app, s)).status, 400); // a deleted operator cannot order
  assert.equal((await call(app, 'GET', '/api/tables/1')).body.order.opened_by, 'Marco');

  const back = await call(app, 'POST', '/api/admin/operators', { name: 'Marco' });
  assert.equal(back.status, 201);
  assert.equal(back.body.id, s.marco.id);
  assert.equal((await call(app, 'GET', '/api/operators')).body.length, 1);
  assert.equal((await call(app, 'POST', '/api/admin/operators', { name: 'Marco' })).status, 409);
});

test('deleting a quick note keeps it on past lines but not on new ones', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  await order(app, s);

  assert.equal((await del(app, `/api/admin/modifiers/${s.hot.id}`)).status, 204);
  assert.deepEqual((await adminMenu(app)).modifiers.map((m) => m.name), ['Decaf']);
  const offered = (await call(app, 'GET', '/api/menu')).body.categories[0].items[0];
  assert.deepEqual(offered.modifiers.map((m) => m.name), ['Decaf']);

  const line = (await call(app, 'GET', '/api/tables/1')).body.order.lines[0];
  assert.deepEqual(line.modifiers.map((m) => m.name), ['Extra hot']);
  const kept = await call(app, 'PATCH', `/api/lines/${line.id}`, {
    operator_id: s.marco.id, modifier_ids: [s.hot.id, s.decaf.id],
  });
  assert.equal(kept.status, 200);
  assert.deepEqual(kept.body.order.lines[0].modifiers.map((m) => m.name).sort(), ['Decaf', 'Extra hot']);

  assert.equal((await order(app, s)).status, 400); // cannot be put on a new line
  assert.equal((await del(app, `/api/admin/modifiers/${s.hot.id}`)).status, 404);
});
