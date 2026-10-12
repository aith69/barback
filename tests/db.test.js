import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../server/db/index.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

test('migrations create the schema and are idempotent', () => {
  const db = freshDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['operators', 'categories', 'items', 'modifiers', 'orders', 'order_lines', 'order_line_modifiers']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  assert.deepEqual(migrate(db), []);
});

test('only one open order per table, closed ones can be reused', () => {
  const db = freshDb();
  const open = db.prepare("INSERT INTO orders (table_number) VALUES (?)");
  const first = open.run(5);
  assert.throws(() => open.run(5), /UNIQUE/);
  db.prepare("UPDATE orders SET status = 'closed' WHERE id = ?").run(first.lastInsertRowid);
  assert.doesNotThrow(() => open.run(5));
});

test('a modifier belongs to a category or an item, not both nor neither', () => {
  const db = freshDb();
  db.prepare("INSERT INTO categories (name) VALUES ('Coffee')").run();
  db.prepare("INSERT INTO items (category_id, name, price_cents) VALUES (1, 'Espresso', 120)").run();
  const ins = db.prepare('INSERT INTO modifiers (category_id, item_id, name) VALUES (?, ?, ?)');
  assert.doesNotThrow(() => ins.run(1, null, 'Decaf'));
  assert.doesNotThrow(() => ins.run(null, 1, 'Extra hot'));
  assert.throws(() => ins.run(1, 1, 'Both'), /CHECK/);
  assert.throws(() => ins.run(null, null, 'Neither'), /CHECK/);
});

test('item prices cannot be negative', () => {
  const db = freshDb();
  db.prepare("INSERT INTO categories (name) VALUES ('Coffee')").run();
  assert.throws(
    () => db.prepare("INSERT INTO items (category_id, name, price_cents) VALUES (1, 'X', -1)").run(),
    /CHECK/,
  );
});
