import test from 'node:test';
import assert from 'node:assert/strict';
import { call, makeApp } from './helpers.js';

test('operators: create, trim, no duplicates, deactivate', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());

  const created = await call(app, 'POST', '/api/admin/operators', { name: '  Marco ' });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Marco');
  assert.equal(created.body.active, true);

  assert.equal((await call(app, 'POST', '/api/admin/operators', { name: 'Marco' })).status, 409);
  assert.equal((await call(app, 'POST', '/api/admin/operators', { name: '   ' })).status, 400);
  assert.equal((await call(app, 'POST', '/api/admin/operators', {})).status, 400);

  const off = await call(app, 'PATCH', `/api/admin/operators/${created.body.id}`, { active: false });
  assert.equal(off.body.active, false);
  assert.equal((await call(app, 'PATCH', '/api/admin/operators/999', { active: false })).status, 404);
  assert.equal((await call(app, 'PATCH', `/api/admin/operators/${created.body.id}`, {})).status, 400);

  const list = await call(app, 'GET', '/api/admin/operators');
  assert.equal(list.body.length, 1); // deactivated, not deleted
});

test('menu: categories and items, ordering, validation', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());

  const coffee = (await call(app, 'POST', '/api/admin/categories', { name: 'Coffee' })).body;
  const drinks = (await call(app, 'POST', '/api/admin/categories', { name: 'Drinks' })).body;
  const espresso = (await call(app, 'POST', '/api/admin/items', { category_id: coffee.id, name: 'Espresso', price_cents: 120 })).body;
  const cappuccino = (await call(app, 'POST', '/api/admin/items', { category_id: coffee.id, name: 'Cappuccino', price_cents: 150 })).body;
  assert.equal(espresso.sold_out, false);
  assert.ok(cappuccino.sort_order > espresso.sort_order);

  const bad = (payload) => call(app, 'POST', '/api/admin/items', { category_id: coffee.id, name: 'X', price_cents: 100, ...payload });
  assert.equal((await bad({ price_cents: -5 })).status, 400);
  assert.equal((await bad({ price_cents: 1.5 })).status, 400);
  assert.equal((await bad({ category_id: 999 })).status, 400);
  assert.equal((await bad({ name: '' })).status, 400);

  assert.equal((await call(app, 'PUT', '/api/admin/items/order', { ids: [cappuccino.id, espresso.id] })).status, 204);
  assert.equal((await call(app, 'PUT', '/api/admin/categories/order', { ids: [drinks.id, coffee.id] })).status, 204);
  let menu = (await call(app, 'GET', '/api/admin/menu')).body;
  assert.deepEqual(menu.items.map((i) => i.name), ['Cappuccino', 'Espresso']);
  assert.deepEqual(menu.categories.map((c) => c.name), ['Drinks', 'Coffee']);

  const updated = await call(app, 'PATCH', `/api/admin/items/${espresso.id}`, { price_cents: 130, sold_out: true });
  assert.equal(updated.body.price_cents, 130);
  assert.equal(updated.body.sold_out, true);

  await call(app, 'PATCH', `/api/admin/categories/${coffee.id}`, { active: false });
  menu = (await call(app, 'GET', '/api/admin/menu')).body;
  assert.equal(menu.categories.find((c) => c.id === coffee.id).active, false);
  assert.equal(menu.categories.length, 2);

  
});

test('quick notes belong to a category or to an item', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());

  const coffee = (await call(app, 'POST', '/api/admin/categories', { name: 'Coffee' })).body;
  const espresso = (await call(app, 'POST', '/api/admin/items', { category_id: coffee.id, name: 'Espresso', price_cents: 120 })).body;

  const catNote = await call(app, 'POST', '/api/admin/modifiers', { category_id: coffee.id, name: 'Decaf' });
  const itemNote = await call(app, 'POST', '/api/admin/modifiers', { item_id: espresso.id, name: 'Extra hot' });
  assert.equal(catNote.status, 201);
  assert.equal(catNote.body.item_id, null);
  assert.equal(itemNote.body.category_id, null);

  const note = (payload) => call(app, 'POST', '/api/admin/modifiers', payload);
  assert.equal((await note({ category_id: coffee.id, item_id: espresso.id, name: 'Both' })).status, 400);
  assert.equal((await note({ name: 'Neither' })).status, 400);
  assert.equal((await note({ category_id: 999, name: 'Ghost' })).status, 400);

  await call(app, 'PATCH', `/api/admin/modifiers/${catNote.body.id}`, { name: 'Decaffeinated', active: false });
  const menu = (await call(app, 'GET', '/api/admin/menu')).body;
  assert.equal(menu.modifiers.length, 2);
  const renamed = menu.modifiers.find((m) => m.id === catNote.body.id);
  assert.equal(renamed.name, 'Decaffeinated');
  assert.equal(renamed.active, false);
});
