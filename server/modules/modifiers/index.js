import { cleanBody, idParams, mapBools, nameSchema, nextSort, patchRow } from '../../db/helpers.js';
import { httpError } from '../../lib/errors.js';

const price = { type: 'integer', minimum: 0, maximum: 1000000 }; // cents, 0 = no extra charge

// Quick notes ("decaf", "no ice"). A note belongs to a category (and is then
// offered on all its items) or to a single item. It can add a price (0 by default).
export default async function modifiers(app) {
  const { db } = app;
  const get = db.prepare('SELECT * FROM modifiers WHERE id = ?');
  const out = (row) => mapBools(row, ['active', 'required']);

  app.post(
    '/api/admin/modifiers',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            category_id: { type: 'integer' },
            item_id: { type: 'integer' },
            name: nameSchema,
            price_cents: price,
            required: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const { category_id, item_id, name, price_cents = 0, required = false } = cleanBody(req.body);
      if ((category_id == null) === (item_id == null)) {
        throw httpError(400, 'give either category_id or item_id');
      }
      const [col, val] = category_id != null ? ['category_id', category_id] : ['item_id', item_id];
      const { lastInsertRowid } = db
        .prepare('INSERT INTO modifiers (category_id, item_id, name, price_cents, required, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
        .run(category_id ?? null, item_id ?? null, name, price_cents, required ? 1 : 0, nextSort(db, 'modifiers', `${col} = ?`, val));
      return reply.code(201).send(out(get.get(lastInsertRowid)));
    },
  );

  app.patch(
    '/api/admin/modifiers/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          properties: { name: nameSchema, price_cents: price, active: { type: 'boolean' }, required: { type: 'boolean' } },
        },
      },
    },
    async (req) => {
      patchRow(db, 'modifiers', req.params.id, cleanBody(req.body), ['name', 'price_cents', 'active', 'required']);
      return out(get.get(req.params.id));
    },
  );
}
