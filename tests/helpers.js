import { buildApp } from '../server/app.js';
import { defaults } from '../server/config.js';

export const makeApp = (extra = {}) => buildApp({ ...defaults, dbPath: ':memory:', ...extra });

// Calls the API in-process: { status, body }
export async function call(app, method, url, payload) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: res.body ? res.json() : null };
}
