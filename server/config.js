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
  tablesInside: 7, // tables 1..N are inside
  tablesOutside: 13, // the following ones are outside: a line separates the two groups
  maxTables: 20, // total (inside + outside), always recomputed from the two above
  sharedPin: '1234', // shared PIN for cash, admin and stats (digits): change it in config.local.json; '' turns the PIN off
  pinSessionHours: 12, // how long an unlocked session lasts
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
  // Tables: how many inside and how many outside. An old config with only maxTables
  // keeps working: all of them inside, no separator.
  const given = (key) => [local, overrides].some((o) => key in o);
  if (!given('tablesInside') && !given('tablesOutside') && given('maxTables')) {
    cfg.tablesInside = cfg.maxTables;
    cfg.tablesOutside = 0;
  }
  cfg.maxTables = cfg.tablesInside + cfg.tablesOutside;

  if (cfg.dbPath !== ':memory:' && !path.isAbsolute(cfg.dbPath)) {
    cfg.dbPath = path.join(root, cfg.dbPath);
  }
  return cfg;
}
