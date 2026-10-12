import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../server/db/index.js';
import { createBackupService } from '../server/modules/backup/service.js';
import { seedDemo } from '../server/lib/demo.js';
import { makeApp } from './helpers.js';

function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barback-'));
  const db = openDb(path.join(dir, 'barback.db'));
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const svc = createBackupService(db, { backupDir: path.join(dir, 'backups'), backupKeep: 2, backupHour: 0, timezone: 'UTC', ...options });
  return { db, svc };
}

test('a backup is a complete, readable copy of the database', async (t) => {
  const { db, svc } = setup(t);
  const file = await svc.run();
  const copy = new Database(file);
  const migrations = (conn) => conn.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
  assert.equal(migrations(copy), migrations(db));
  assert.ok(copy.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'order_lines'").get().n === 1);
  copy.close();
});

test('only the most recent backups are kept', async (t) => {
  const { svc } = setup(t, { backupKeep: 2 });
  const made = [];
  for (let i = 0; i < 4; i++) made.push(path.basename(await svc.run(new Date(Date.now() + i * 1000))));
  assert.deepEqual(svc.list(), made.slice(-2));
});

test('a backup is due once a day, after the backup hour', async (t) => {
  const early = setup(t, { backupHour: 4 });
  assert.equal(early.svc.due(new Date('2026-10-12T03:30:00Z')), false); // too early
  assert.equal(early.svc.due(new Date('2026-10-12T05:00:00Z')), true);

  const { svc } = setup(t, { backupHour: 0 });
  assert.equal(svc.due(), true);
  await svc.run();
  assert.equal(svc.due(), false); // already made today
});

test('demo data is added to an empty database only', async (t) => {
  const app = await makeApp({ language: 'it' });
  t.after(() => app.close());
  const count = () => app.db.prepare('SELECT COUNT(*) AS n FROM items WHERE is_custom = 0').get().n;
  assert.equal(await seedDemo(app), true);
  const after = count();
  assert.ok(after >= 8);
  assert.equal(await seedDemo(app), false);
  assert.equal(count(), after);
});
