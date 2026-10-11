import system from './system/index.js';
import operators from './operators/index.js';
import menu from './menu/index.js';
import modifiers from './modifiers/index.js';

// Each module is a Fastify plugin. Optional modules are switched on by
// config.modules[name]; core ones are always on.
export const modules = [
  { name: 'system', plugin: system, core: true },
  { name: 'operators', plugin: operators, core: true },
  { name: 'menu', plugin: menu, core: true },
  { name: 'modifiers', plugin: modifiers, core: true },
  // later: orders, auth, stats, events, customer
];

export const isEnabled = (mod, config) => mod.core || config.modules[mod.name] === true;
