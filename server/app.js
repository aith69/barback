import Fastify from 'fastify';
import { EventEmitter } from 'node:events';
import { createAuth } from './modules/auth/session.js';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { defaults, root } from './config.js';
import { openDb } from './db/index.js';
import { createI18n, loadLocales } from './i18n/index.js';
import { modules, isEnabled } from './modules/index.js';

export async function buildApp(config, { logger = false } = {}) {
  const app = Fastify({ logger, forceCloseConnections: true }); // open event streams must not block shutdown
  const db = openDb(config.dbPath);
  const locales = loadLocales();
  const i18n = createI18n(locales, config.language);
  if (i18n.language !== config.language) {
    app.log.warn(`Language "${config.language}" not found, using "${i18n.language}"`);
  }

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('i18n', i18n);

  // Every successful write tells the open pages to refresh (see /api/events).
  const events = new EventEmitter();
  events.setMaxListeners(100);
  app.decorate('events', events);

  // The shared PIN protects the cash register, admin and statistics (see modules/auth).
  const auth = createAuth(config);
  app.decorate('auth', auth);
  if (auth.enabled && String(config.sharedPin) === defaults.sharedPin) {
    app.log.warn('sharedPin is still the default: set your own in config.local.json');
  }
  app.addHook('onRequest', async (req, reply) => {
    if (!auth.enabled || !auth.needsPin(req.method, req.routeOptions?.url ?? '')) return;
    if (auth.isValid(auth.readToken(req))) return;
    return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'pin required' });
  });
  app.addHook('onResponse', async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && reply.statusCode < 400 && req.url.startsWith('/api/') && !req.url.startsWith('/api/auth/')) {
      app.events.emit('change', { type: 'change' });
    }
  });
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
