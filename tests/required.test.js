import test from 'node:test';
import assert from 'node:assert/strict';
import { call, makeApp } from './helpers.js';

async function setup(app) {
  const post = async (url, body) => (await call(app, 'POST', url, body)).body;
  const marco = await post('/api/admin/operators', { name: 'Marco' });
  const coffee = await post('/api/admin/categories', { name: 'Coffee' });
  const snacks = await post('/api/admin/categories', { name: 'Snacks' });
  const espresso = await post('/api/admin/items', { category_id: coffee.id, name: 'Espresso', price_cents: 120 });
  const toast = await post('/api/admin/items', { category_id: snacks.id, name: 'Toast', price_cents: 400 });
  const soy = await post('/api/admin/modifiers', { category_id: coffee.id, name: 'Soy milk', price_cents: 30 });
  const decaf = await post('/api/admin/modifiers', { category_id: coffee.id, name: 'Decaf', required: true });
  const regular = await post('/api/admin/modifiers', { category_id: coffee.id, name: 'Regular', required: true });
  return { marco, espresso, toast, soy, decaf, regular };
}

const order = (app, s, table, item, modifier_ids) =>
  call(app, 'POST', `/api/tables/${table}/lines`, {
    operator_id: s.marco.id,
    lines: [{ item_id: item.id, quantity: 1, modifier_ids }],
  });

test('the required flag is stored, changed and shown in the menu', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await setup(app);
  assert.deepEqual([s.soy.required, s.decaf.required], [false, true]);

  const menu = (await call(app, 'GET', '/api/menu')).body;
  const espresso = menu.categories[0].items[0];
  assert.deepEqual(espresso.modifiers.map((m) => [m.name, m.required]), [['Soy milk', false], ['Decaf', true], ['Regular', true]]);

  const patched = await call(app, 'PATCH', `/api/admin/modifiers/${s.decaf.id}`, { required: false });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.required, false);
});

test('an item with required notes needs at least one of them, more than one is fine', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await setup(app);

  assert.equal((await order(app, s, 1, s.espresso, [])).status, 400); // nothing chosen
  assert.equal((await order(app, s, 1, s.espresso, [s.soy.id])).status, 400); // only a note that is not required
  assert.equal((await order(app, s, 1, s.espresso, [s.decaf.id])).status, 201);
  assert.equal((await order(app, s, 2, s.espresso, [s.decaf.id, s.regular.id, s.soy.id])).status, 201);
  assert.equal((await order(app, s, 3, s.toast, [])).status, 201); // no required notes on this item

  const placed = await order(app, s, 4, s.espresso, [s.decaf.id]);
  const lineId = placed.body.order.lines[0].id;
  const edit = (modifier_ids) => call(app, 'PATCH', `/api/lines/${lineId}`, { operator_id: s.marco.id, modifier_ids });
  assert.equal((await edit([])).status, 400);
  assert.equal((await edit([s.soy.id])).status, 400);
  assert.equal((await edit([s.regular.id])).status, 200);
});

test('once no note is required any more, the item can be ordered without notes', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await setup(app);
  assert.equal((await order(app, s, 1, s.espresso, [])).status, 400);
  for (const m of [s.decaf, s.regular]) await call(app, 'PATCH', `/api/admin/modifiers/${m.id}`, { required: false });
  assert.equal((await order(app, s, 1, s.espresso, [])).status, 201);
});
