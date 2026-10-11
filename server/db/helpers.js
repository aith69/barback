import { httpError } from '../lib/errors.js';

export const idParams = { type: 'object', properties: { id: { type: 'integer' } } };
export const nameSchema = { type: 'string', minLength: 1, maxLength: 80 };

// SQLite stores booleans as 0/1: expose them as true/false.
export const mapBools = (row, keys) => {
  const out = { ...row };
  for (const k of keys) out[k] = Boolean(out[k]);
  return out;
};

// Trims `name` and rejects blank names.
export function cleanBody(body) {
  const out = { ...body };
  if ('name' in out) {
    out.name = String(out.name).trim();
    if (!out.name) throw httpError(400, 'name is empty');
  }
  return out;
}

// Partial update. Table and column names come from code, never from the request.
export function patchRow(db, table, id, body, allowed) {
  const keys = allowed.filter((k) => body[k] !== undefined);
  if (!keys.length) throw httpError(400, 'nothing to update');
  const values = Object.fromEntries(keys.map((k) => [k, typeof body[k] === 'boolean' ? Number(body[k]) : body[k]]));
  const sets = keys.map((k) => `${k} = @${k}`).join(', ');
  const res = db.prepare(`UPDATE ${table} SET ${sets} WHERE id = @id`).run({ ...values, id });
  if (!res.changes) throw httpError(404, 'not found');
}

export const nextSort = (db, table, where = '1', ...params) =>
  db.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM ${table} WHERE ${where}`).get(...params).n;

// Sets sort_order = position in `ids` (1-based), atomically.
export function reorder(db, table, ids) {
  const upd = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`);
  db.transaction(() => ids.forEach((id, i) => upd.run(i + 1, id)))();
}
