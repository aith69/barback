import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { root } from './config.js';
import { openDb } from './db/index.js';
import { createI18n, loadLocales } from './i18n/index.js';
import { modules, isEnabled } from './modules/index.js';

export async function buildApp(config, { logger = false } = {}) {
  const app = Fastify({ logger });
  const db = openDb(config.dbPath);
  const locales = loadLocales();
  const i18n = createI18n(locales, config.language);
  if (i18n.language !== config.language) {
    app.log.warn(`Language "${config.language}" not found, using "${i18n.language}"`);
  }

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('i18n', i18n);
  app.addHook('onClose', async () => db.close());

  for (const mod of modules) {
    if (isEnabled(mod, config)) await app.register(mod.plugin);
  }
  await app.register(fastifyStatic, { root: path.join(root, 'web') });
  return app;
}
