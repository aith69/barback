import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { defaults } from '../server/config.js';
import { csvFormat } from '../server/lib/csv.js';
import { call, makeApp } from './helpers.js';

async function seed(app) {
  const post = async (url, body) => (await call(app, 'POST', url, body)).body;
  const marco = await post('/api/admin/operators', { name: 'Marco' });
  const coffee = await post('/api/admin/categories', { name: 'Coffee' });
  const espresso = await post('/api/admin/items', { category_id: coffee.id, name: 'Espresso', price_cents: 120 });
  const cappuccino = await post('/api/admin/items', { category_id: coffee.id, name: 'Cappuccino', price_cents: 150 });
  const soy = await post('/api/admin/modifiers', { category_id: coffee.id, name: 'Soy milk', price_cents: 30 });
  const decaf = await post('/api/admin/modifiers', { category_id: coffee.id, name: 'Decaf' });
  return { marco, espresso, cappuccino, soy, decaf };
}

// Places an order, prices its custom items, closes it, then moves the closing time to `closedAt`.
async function sale(app, s, table, lines, { paid, closedAt, customPrice = 0 }) {
  const placed = await call(app, 'POST', `/api/tables/${table}/lines`, { operator_id: s.marco.id, lines });
  assert.equal(placed.status, 201);
  let order = placed.body.order;
  for (const l of order.lines.filter((x) => x.price_pending)) {
    order = (await call(app, 'PUT', `/api/lines/${l.id}/price`, { price_cents: customPrice })).body.order;
  }
  const closed = await call(app, 'POST', `/api/counter/tables/${table}/close`, {
    operator_id: s.marco.id,
    total_paid_cents: paid ?? order.subtotal_cents,
  });
  assert.equal(closed.status, 200);
  app.db.prepare('UPDATE orders SET closed_at = ? WHERE id = ?').run(closedAt, closed.body.order_id);
  return order;
}

async function salesWeek(app, s) {
  const espresso = (quantity) => ({ item_id: s.espresso.id, quantity });
  await sale(app, s, 1, [espresso(3)], { closedAt: '2026-10-11T22:30:00.000Z' }); // 00:30 on the 12th in Rome
  await sale(app, s, 2, [espresso(3)], { paid: 350, closedAt: '2026-10-12T08:00:00.000Z' });
  await sale(app, s, 3, [{ item_id: s.cappuccino.id, quantity: 1 }], { closedAt: '2026-10-11T21:30:00.000Z' }); // 23:30 on the 11th
  await sale(app, s, 4, [espresso(1)], { closedAt: '2026-10-20T10:00:00.000Z' }); // outside the ranges asked
  await call(app, 'POST', '/api/tables/5/lines', { operator_id: s.marco.id, lines: [espresso(2)] }); // still open
}

test('revenue is split in days by the local time zone, weeks start on Monday', async (t) => {
  const app = await makeApp({ timezone: 'Europe/Rome' });
  t.after(() => app.close());
  await salesWeek(app, await seed(app));
  const get = async (query) => (await call(app, 'GET', `/api/stats/revenue?${query}`)).body;

  const days = await get('from=2026-10-11&to=2026-10-12&group=day');
  assert.deepEqual(days.rows, [
    { period: '2026-10-11', orders: 1, subtotal_cents: 150, adjustment_cents: 0, paid_cents: 150 },
    { period: '2026-10-12', orders: 2, subtotal_cents: 720, adjustment_cents: -10, paid_cents: 710 },
  ]);
  assert.deepEqual(days.totals, { orders: 3, subtotal_cents: 870, adjustment_cents: -10, paid_cents: 860 });

  const weeks = await get('from=2026-10-11&to=2026-10-12&group=week');
  assert.deepEqual(weeks.rows.map((r) => [r.period, r.orders]), [['2026-10-05', 1], ['2026-10-12', 2]]);

  const month = await get('from=2026-10-01&to=2026-10-31&group=month');
  assert.deepEqual(month.rows.map((r) => [r.period, r.orders, r.paid_cents]), [['2026-10', 4, 980]]);
  assert.deepEqual((await get('from=2026-10-13&to=2026-10-19&group=day')).rows, []); // open orders do not count

  // the same sales in UTC: the first one belongs to the 11th
  const utc = await makeApp({ timezone: 'UTC' });
  t.after(() => utc.close());
  await salesWeek(utc, await seed(utc));
  const utcDays = (await call(utc, 'GET', '/api/stats/revenue?from=2026-10-11&to=2026-10-12&group=day')).body;
  assert.deepEqual(utcDays.rows.map((r) => [r.period, r.orders]), [['2026-10-11', 2], ['2026-10-12', 1]]);
});

test('products sold: closed orders only, variants in the value, custom requests apart', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  const closedAt = '2026-10-12T10:00:00.000Z';

  await sale(app, s, 1, [{ item_id: s.espresso.id, quantity: 3 }], { closedAt });
  await sale(app, s, 2, [
    { item_id: s.espresso.id, quantity: 1 },
    { item_id: s.cappuccino.id, quantity: 2, modifier_ids: [s.soy.id] },
    { custom_name: 'Toast', quantity: 2 },
  ], { closedAt, customPrice: 400 });
  await sale(app, s, 3, [{ custom_name: ' toast ', quantity: 1 }], { closedAt, customPrice: 400 });

  // a removed line does not count
  const placed = await call(app, 'POST', '/api/tables/4/lines', {
    operator_id: s.marco.id,
    lines: [{ item_id: s.espresso.id, quantity: 5 }, { item_id: s.cappuccino.id, quantity: 1 }],
  });
  await call(app, 'DELETE', `/api/lines/${placed.body.order.lines[0].id}?operator_id=${s.marco.id}`);
  const closed = await call(app, 'POST', '/api/counter/tables/4/close', { operator_id: s.marco.id, total_paid_cents: 150 });
  app.db.prepare('UPDATE orders SET closed_at = ? WHERE id = ?').run(closedAt, closed.body.order_id);

  // an open order does not count
  await call(app, 'POST', '/api/tables/5/lines', { operator_id: s.marco.id, lines: [{ item_id: s.espresso.id, quantity: 9 }] });

  const res = (await call(app, 'GET', '/api/stats/products?from=2026-10-12&to=2026-10-12')).body;
  assert.deepEqual(
    res.items.map((x) => [x.name, x.category, x.quantity, x.revenue_cents]),
    [['Espresso', 'Coffee', 4, 480], ['Cappuccino', 'Coffee', 3, 510]], // 2 cappuccinos with soy at 1,80 + 1 plain
  );
  assert.equal(res.custom.length, 1); // "Toast" and " toast " are the same request
  assert.equal(res.custom[0].name.toLowerCase(), 'toast');
  assert.deepEqual([res.custom[0].quantity, res.custom[0].revenue_cents], [3, 1200]);
});

test('variants and free-text notes are counted inside each product', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const s = await seed(app);
  const closedAt = '2026-10-12T10:00:00.000Z';

  await sale(app, s, 1, [
    { item_id: s.cappuccino.id, quantity: 2, modifier_ids: [s.soy.id] },
    { item_id: s.espresso.id, quantity: 1, modifier_ids: [s.soy.id, s.decaf.id], note: 'very hot' },
    { item_id: s.espresso.id, quantity: 2, note: ' VERY HOT ' },
  ], { closedAt });
  await sale(app, s, 2, [{ item_id: s.espresso.id, quantity: 1, note: 'free text only' }], { closedAt });
  await call(app, 'POST', '/api/tables/3/lines', {
    operator_id: s.marco.id,
    lines: [{ item_id: s.espresso.id, quantity: 4, modifier_ids: [s.decaf.id] }], // open: not counted
  });

  const { items } = (await call(app, 'GET', '/api/stats/products?from=2026-10-12&to=2026-10-12')).body;
  const espresso = items.find((x) => x.name === 'Espresso');
  const cappuccino = items.find((x) => x.name === 'Cappuccino');

  assert.deepEqual(espresso.variants.map((v) => [v.name, v.quantity, v.revenue_cents]), [['Decaf', 1, 0], ['Soy milk', 1, 30]]);
  assert.deepEqual(espresso.notes.map((n) => [n.name.toLowerCase(), n.quantity]), [['very hot', 3], ['free text only', 1]]);
  assert.deepEqual(cappuccino.variants.map((v) => [v.name, v.quantity, v.revenue_cents]), [['Soy milk', 2, 60]]);
  assert.deepEqual(cappuccino.notes, []);

  const csv = (await app.inject('/api/stats/export.csv?kind=products&from=2026-10-12&to=2026-10-12')).body.split('\r\n');
  assert.ok(csv.includes('Espresso,Coffee,Variant,Soy milk,1,0.30'));
  assert.ok(csv.some((l) => l.startsWith('Espresso,Coffee,Free text,')));
  assert.equal((await call(app, 'GET', '/api/stats/modifiers')).status, 404); // the section is gone
});

test('CSV export follows the UI language and is safe to open in a spreadsheet', async (t) => {
  const app = await makeApp({ language: 'it', timezone: 'Europe/Rome' });
  t.after(() => app.close());
  const s = await seed(app);
  await salesWeek(app, s);
  await sale(app, s, 6, [{ custom_name: '=SUM(A1)', quantity: 1 }], { closedAt: '2026-10-12T09:00:00.000Z', customPrice: 100 });
  const csv = (query) => app.inject(`/api/stats/export.csv?${query}`);

  const res = await csv('kind=revenue&from=2026-10-11&to=2026-10-12&group=day');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.headers['content-disposition'], /attachment; filename="barback-revenue-2026-10-11_2026-10-12\.csv"/);
  assert.ok(res.body.startsWith('\uFEFF'));
  const lines = res.body.trim().split('\r\n');
  assert.equal(lines[0].split(';').length, 5);
  assert.equal(lines[1], '2026-10-11;1;1,50;0,00;1,50');
  assert.equal(lines[2], '2026-10-12;3;8,20;-0,10;8,10'); // negative amounts stay numbers

  const orders = await csv('kind=orders&from=2026-10-11&to=2026-10-12');
  assert.ok(orders.body.includes('2026-10-12 00:30;1;Marco;Marco;3,60;0,00;3,60'));

  const custom = await csv('kind=custom&from=2026-10-12&to=2026-10-12');
  assert.ok(custom.body.includes("'=SUM(A1)")); // would be a formula otherwise

  assert.deepEqual([csvFormat('it').delimiter, csvFormat('it').money(150)], [';', '1,50']);
  assert.deepEqual([csvFormat('en').delimiter, csvFormat('en').money(150)], [',', '1.50']);
});

test('stats: invalid ranges are refused, and the PIN protects everything', async (t) => {
  const app = await makeApp();
  t.after(() => app.close());
  const status = async (url) => (await call(app, 'GET', url)).status;

  assert.equal(await status('/api/stats/revenue'), 200); // default: the last 30 days
  assert.equal(await status('/api/stats/revenue?from=abc'), 400);
  assert.equal(await status('/api/stats/revenue?from=2026-02-30&to=2026-03-01'), 400);
  assert.equal(await status('/api/stats/revenue?from=2026-10-12&to=2026-10-01'), 400);
  assert.equal(await status('/api/stats/revenue?from=2000-01-01&to=2026-10-12'), 400);
  assert.equal(await status('/api/stats/revenue?group=year'), 400);
  assert.equal(await status('/api/stats/export.csv'), 400);
  assert.equal(await status('/api/stats/export.csv?kind=secrets'), 400);

  const locked = await buildApp({ ...defaults, dbPath: ':memory:', sharedPin: '4321' });
  t.after(() => locked.close());
  for (const url of ['/api/stats/revenue', '/api/stats/products', '/api/stats/export.csv?kind=orders']) {
    assert.equal((await locked.inject(url)).statusCode, 401, url);
  }
  const login = await locked.inject({ method: 'POST', url: '/api/auth/login', payload: { pin: '4321' } });
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  assert.equal((await locked.inject({ url: '/api/stats/revenue', headers: { cookie } })).statusCode, 200);
});
