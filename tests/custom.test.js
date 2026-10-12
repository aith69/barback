import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { call, makeApp } from './helpers.js';

async function seed(app) {
  const post = async (url, body) => (await call(app, 'POST', url, body)).body;
  const marco = await post('/api/admin/operators', { name: 'Marco' });
  const coffee = await post('/api/admin/categories', { name: 'Coffee' });
  const espresso = await post('/api/admin/items', { category_id: coffee.id, name: 'Espresso', price_cents: 120 });
  return { marco, coffee, espresso };
}

const add = (app, table, operator, lines) =>
  call(app, 'POST', `/api/tables/${table}/lines`, { operator_id: operator.id, lines });
const orderOf = async (app, n) => (await call(app, 'GET', `/api/tables/${n}`)).body.order;

test('custom items have no price until the counter or the cash register sets it', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);

  const res = await add(app, 3, s.marco, [
    { custom_name: '  Panino speciale ', quantity: 2 },
    { item_id: s.espresso.id, quantity: 1 },
  ]);
  assert.equal(res.status, 201);
  const [custom, espresso] = res.body.order.lines;
  assert.equal(custom.item_name, 'Panino speciale');
  assert.equal(custom.price_pending, true);
  assert.equal(espresso.price_pending, false);
  assert.equal(res.body.order.unpriced, 1);
  assert.equal(res.body.order.subtotal_cents, 120); // the custom item counts 0 for now

  const row = (await call(app, 'GET', '/api/counter/tables')).body.find((x) => x.number === 3);
  assert.equal(row.unpriced, 1);
  const queued = (await call(app, 'GET', '/api/counter/queue')).body[0].lines;
  assert.equal(queued.find((l) => l.id === custom.id).price_pending, true);

  // no price: cannot be prepared (line or table) and the bill cannot be closed
  const prepared = (id) => call(app, 'PUT', `/api/counter/lines/${id}/status`, { status: 'prepared' });
  assert.equal((await prepared(custom.id)).status, 409);
  assert.equal((await call(app, 'POST', '/api/counter/tables/3/prepared', { prepared: true })).status, 409);
  const close = (paid) => call(app, 'POST', '/api/counter/tables/3/close', { operator_id: s.marco.id, total_paid_cents: paid });
  assert.equal((await close(120)).status, 409);
  assert.equal((await orderOf(app, 3)).status, 'open');
  assert.equal((await prepared(espresso.id)).status, 204); // a normal line is fine on its own

  // set the price, then correct it
  const priced = await call(app, 'PUT', `/api/lines/${custom.id}/price`, { price_cents: 250 });
  assert.equal(priced.status, 200);
  assert.equal(priced.body.order.unpriced, 0);
  assert.equal(priced.body.order.subtotal_cents, 2 * 250 + 120);
  assert.equal(priced.body.order.lines[0].price_pending, false);
  assert.equal((await call(app, 'PUT', `/api/lines/${custom.id}/price`, { price_cents: 300 })).body.order.subtotal_cents, 720);

  // now it can be prepared and the bill closed
  assert.equal((await call(app, 'POST', '/api/counter/tables/3/prepared', { prepared: true })).status, 204);
  const done = await close(700);
  assert.equal(done.status, 200);
  assert.deepEqual([done.body.subtotal_cents, done.body.adjustment_cents], [720, -20]);
});

test('custom items: validation and who can get a price', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);

  assert.equal((await add(app, 4, s.marco, [{ custom_name: '   ', quantity: 1 }])).status, 400);
  assert.equal((await add(app, 4, s.marco, [{ quantity: 1 }])).status, 400);
  assert.equal((await add(app, 4, s.marco, [{ custom_name: 'X', quantity: 1, modifier_ids: [1] }])).status, 400);
  assert.equal((await call(app, 'GET', '/api/tables/4')).body.order, null); // nothing was created

  const normal = (await add(app, 5, s.marco, [{ item_id: s.espresso.id, quantity: 1 }])).body.order.lines[0];
  assert.equal((await call(app, 'PUT', `/api/lines/${normal.id}/price`, { price_cents: 100 })).status, 400);
  assert.equal((await call(app, 'PUT', '/api/lines/999/price', { price_cents: 100 })).status, 404);

  const custom = (await add(app, 5, s.marco, [{ custom_name: 'Toast', quantity: 1 }])).body.order.lines[1];
  assert.equal((await call(app, 'PUT', `/api/lines/${custom.id}/price`, { price_cents: -1 })).status, 400);
  assert.equal((await call(app, 'PUT', `/api/lines/${custom.id}/price`, { price_cents: 0 })).status, 200); // free is a price too

  // removing the unpriced line unblocks the table
  const other = (await add(app, 6, s.marco, [{ custom_name: 'Toast', quantity: 1 }])).body.order.lines[0];
  assert.equal((await call(app, 'POST', '/api/counter/tables/6/prepared', { prepared: true })).status, 409);
  await call(app, 'DELETE', `/api/lines/${other.id}?operator_id=${s.marco.id}`);
  assert.equal((await call(app, 'POST', '/api/counter/tables/6/close', { operator_id: s.marco.id, total_paid_cents: 0 })).status, 200);
});

test('quick notes carry a price that is frozen on the line', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  const post = async (body) => call(app, 'POST', '/api/admin/modifiers', { category_id: s.coffee.id, ...body });

  const soy = (await post({ name: 'Soy milk', price_cents: 30 })).body;
  const decaf = (await post({ name: 'Decaf' })).body;
  assert.equal(soy.price_cents, 30);
  assert.equal(decaf.price_cents, 0);
  assert.equal((await post({ name: 'Bad', price_cents: -1 })).status, 400);

  const offered = (await call(app, 'GET', '/api/menu')).body.categories[0].items[0].modifiers;
  assert.deepEqual(offered.map((m) => [m.name, m.price_cents]), [['Soy milk', 30], ['Decaf', 0]]);

  const res = await add(app, 2, s.marco, [{ item_id: s.espresso.id, quantity: 2, modifier_ids: [soy.id, decaf.id] }]);
  const line = res.body.order.lines[0];
  assert.equal(line.unit_price_cents, 150);
  assert.equal(res.body.order.subtotal_cents, 300);
  assert.deepEqual(line.modifiers.map((m) => m.price_cents).sort(), [0, 30]);

  // a new price in the menu does not touch the line
  await call(app, 'PATCH', `/api/admin/modifiers/${soy.id}`, { price_cents: 99 });
  assert.equal((await orderOf(app, 2)).subtotal_cents, 300);

  const patch = (modifier_ids) => call(app, 'PATCH', `/api/lines/${line.id}`, { operator_id: s.marco.id, modifier_ids });
  assert.equal((await patch([decaf.id])).body.order.lines[0].unit_price_cents, 120); // note dropped
  assert.equal((await patch([soy.id, decaf.id])).body.order.lines[0].unit_price_cents, 219); // added again: current price

  // a note that stays on the line keeps the price it had
  await call(app, 'PATCH', `/api/admin/modifiers/${soy.id}`, { price_cents: 10 });
  assert.equal((await patch([soy.id, decaf.id])).body.order.lines[0].unit_price_cents, 219);
});

test('a free-text note can carry a price; without a note it counts nothing', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);

  const res = await add(app, 4, s.marco, [
    { item_id: s.espresso.id, quantity: 1, note: 'oat milk', note_price_cents: 50 },
    { item_id: s.espresso.id, quantity: 1, note_price_cents: 70 },
  ]);
  const [withNote, noNote] = res.body.order.lines;
  assert.equal(withNote.unit_price_cents, 170);
  assert.equal(withNote.note_price_cents, 50);
  assert.equal(noNote.unit_price_cents, 120); // a price without a note is ignored
  assert.equal(noNote.note_price_cents, 0);

  const patch = (id, payload) => call(app, 'PATCH', `/api/lines/${id}`, { operator_id: s.marco.id, ...payload });
  assert.equal((await patch(withNote.id, { note_price_cents: 80 })).body.order.lines[0].unit_price_cents, 200);
  assert.equal((await patch(withNote.id, { note: '' })).body.order.lines[0].unit_price_cents, 120); // note removed
  assert.equal((await patch(noNote.id, { note_price_cents: 70 })).body.order.lines[1].unit_price_cents, 120);
  assert.equal((await patch(noNote.id, { note: 'x', note_price_cents: 70 })).body.order.lines[1].unit_price_cents, 190);
  assert.equal((await add(app, 4, s.marco, [{ item_id: s.espresso.id, quantity: 1, note: 'x', note_price_cents: -5 }])).status, 400);
});

test('tables are split in inside and outside', async (t) => {
  const app = await makeApp({ tablesInside: 3, tablesOutside: 2 });
  t.after(() => app.close());
  const s = await seed(app);

  const grid = (await call(app, 'GET', '/api/tables')).body;
  assert.deepEqual(grid.map((x) => x.area), ['inside', 'inside', 'inside', 'outside', 'outside']);
  const cfg = (await call(app, 'GET', '/api/config')).body;
  assert.deepEqual([cfg.maxTables, cfg.tablesInside], [5, 3]);

  assert.equal((await add(app, 5, s.marco, [{ item_id: s.espresso.id, quantity: 1 }])).status, 201);
  assert.equal((await add(app, 6, s.marco, [{ item_id: s.espresso.id, quantity: 1 }])).status, 404);
});

test('config: inside/outside tables, old maxTables configs keep working', () => {
  const load = (content) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barback-'));
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify(content));
    process.env.BARBACK_CONFIG = file;
    try {
      const c = loadConfig();
      return [c.tablesInside, c.tablesOutside, c.maxTables];
    } finally {
      delete process.env.BARBACK_CONFIG;
      fs.rmSync(dir, { recursive: true });
    }
  };
  assert.deepEqual(load({}), [7, 13, 20]);
  assert.deepEqual(load({ tablesInside: 5, tablesOutside: 3 }), [5, 3, 8]);
  assert.deepEqual(load({ tablesInside: 4 }), [4, 13, 17]);
  assert.deepEqual(load({ maxTables: 12 }), [12, 0, 12]); // old config: all inside, no separator
});
