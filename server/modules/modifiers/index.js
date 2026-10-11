import { cleanBody, idParams, mapBools, nameSchema, nextSort, patchRow } from '../../db/helpers.js';
import { httpError } from '../../lib/errors.js';

// Quick notes ("decaf", "no ice"). A note belongs to a category (and is then
// offered on all its items) or to a single item. Hidden with active=false.
export default async function modifiers(app) {
  const { db } = app;
  const get = db.prepare('SELECT * FROM modifiers WHERE id = ?');
  const out = (row) => mapBools(row, ['active']);

  app.post(
    '/api/admin/modifiers',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { category_id: { type: 'integer' }, item_id: { type: 'integer' }, name: nameSchema },
        },
      },
    },
    async (req, reply) => {
      const { category_id, item_id, name } = cleanBody(req.body);
      if ((category_id == null) === (item_id == null)) {
        throw httpError(400, 'give either category_id or item_id');
      }
      const [col, val] = category_id != null ? ['category_id', category_id] : ['item_id', item_id];
      const { lastInsertRowid } = db
        .prepare('INSERT INTO modifiers (category_id, item_id, name, sort_order) VALUES (?, ?, ?, ?)')
        .run(category_id ?? null, item_id ?? null, name, nextSort(db, 'modifiers', `${col} = ?`, val));
      return reply.code(201).send(out(get.get(lastInsertRowid)));
    },
  );

  app.patch(
    '/api/admin/modifiers/:id',
    {
      schema: {
        params: idParams,
        body: { type: 'object', properties: { name: nameSchema, active: { type: 'boolean' } } },
      },
    },
    async (req) => {
      patchRow(db, 'modifiers', req.params.id, cleanBody(req.body), ['name', 'active']);
      return out(get.get(req.params.id));
    },
  );
}
