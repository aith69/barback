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

  // Map SQLite constraint violations to clean HTTP errors.
  app.setErrorHandler((err, req, reply) => {
    const code = typeof err.code === 'string' ? err.code : '';
    if (code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'already exists' });
    }
    if (code.startsWith('SQLITE_CONSTRAINT')) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'invalid reference or value' });
    }
    return reply.send(err);
  });

  for (const mod of modules) {
    if (isEnabled(mod, config)) await app.register(mod.plugin);
  }
  await app.register(fastifyStatic, { root: path.join(root, 'web') });
  return app;
}
