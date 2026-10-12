import system from './system/index.js';
import operators from './operators/index.js';
import menu from './menu/index.js';
import modifiers from './modifiers/index.js';
import catalog from './catalog/index.js';
import orders from './orders/index.js';
import removal from './removal/index.js';
import counter from './counter/index.js';
import events from './events/index.js';
import served from './served/index.js';
import auth from './auth/index.js';
import stats from './stats/index.js';
import backup from './backup/index.js';

// Each module is a Fastify plugin. Optional modules are switched on by
// config.modules[name]; core ones are always on.
export const modules = [
  { name: 'system', plugin: system, core: true },
  { name: 'operators', plugin: operators, core: true },
  { name: 'menu', plugin: menu, core: true },
  { name: 'modifiers', plugin: modifiers, core: true },
  { name: 'catalog', plugin: catalog, core: true },
  { name: 'orders', plugin: orders, core: true },
  { name: 'removal', plugin: removal, core: true },
  { name: 'counter', plugin: counter, core: true },
  { name: 'events', plugin: events, core: true },
  { name: 'served', plugin: served, core: true },
  { name: 'auth', plugin: auth, core: true },
  { name: 'stats', plugin: stats, core: true },
  { name: 'backup', plugin: backup, core: true },
  // later: auth, stats, customer
];

export const isEnabled = (mod, config) => mod.core || config.modules[mod.name] === true;
