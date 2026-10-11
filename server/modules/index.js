import system from './system/index.js';

// Each module is a Fastify plugin. Optional modules are switched on by
// config.modules[name]; core ones are always on.
export const modules = [
  { name: 'system', plugin: system, core: true },
  // later: tables, menu, modifiers, orders, operators, auth, stats, events, customer
];

export const isEnabled = (mod, config) => mod.core || config.modules[mod.name] === true;
