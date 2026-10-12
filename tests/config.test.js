import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config.js';

test('local config file and overrides are merged over defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barback-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ language: 'it', port: 4000, modules: { customer: true } }));
  process.env.BARBACK_CONFIG = file;
  try {
    const cfg = loadConfig({ port: 5000 });
    assert.equal(cfg.language, 'it');
    assert.equal(cfg.port, 5000);
    assert.equal(cfg.maxTables, 20);
    assert.equal(cfg.modules.customer, true);
    assert.ok(path.isAbsolute(cfg.dbPath));
  } finally {
    delete process.env.BARBACK_CONFIG;
    fs.rmSync(dir, { recursive: true });
  }
});

test('missing config file falls back to defaults', () => {
  process.env.BARBACK_CONFIG = '/nonexistent/barback.json';
  try {
    assert.equal(loadConfig().language, 'en');
  } finally {
    delete process.env.BARBACK_CONFIG;
  }
});
