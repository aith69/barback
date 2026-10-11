import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const defaults = {
  host: '0.0.0.0',
  port: 3000,
  language: 'en', // UI language, never taken from the browser
  currency: 'EUR',
  dbPath: 'data/barback.db',
  maxTables: 20,
  sharedPin: '1234', // shared PIN for counter/admin/stats: change it in config.local.json
  modules: {}, // optional modules, e.g. { "customer": true } in the future
};

// Precedence: defaults < config.local.json (or $BARBACK_CONFIG) < overrides
export function loadConfig(overrides = {}) {
  const file = process.env.BARBACK_CONFIG || path.join(root, 'config.local.json');
  const local = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const cfg = {
    ...defaults,
    ...local,
    ...overrides,
    modules: { ...defaults.modules, ...local.modules, ...overrides.modules },
  };
  if (cfg.dbPath !== ':memory:' && !path.isAbsolute(cfg.dbPath)) {
    cfg.dbPath = path.join(root, cfg.dbPath);
  }
  return cfg;
}
