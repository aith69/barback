import { cleanBody, idParams, mapBools, nameSchema, nextSort, patchRow, reorder } from '../../db/helpers.js';

const bool = { type: 'boolean' };
const orderSchema = {
  body: {
    type: 'object',
    required: ['ids'],
    properties: { ids: { type: 'array', items: { type: 'integer' }, maxItems: 500 } },
  },
};
const price = { type: 'integer', minimum: 0, maximum: 1000000 }; // cents

// Categories and items. Nothing is ever deleted: use active=false to hide,
// so past orders and statistics keep working.
export default async function menu(app) {
  const { db } = app;
  const cat = (row) => mapBools(row, ['active']);
  const item = (row) => mapBools(row, ['active', 'sold_out']);
  const getCat = db.prepare('SELECT * FROM categories WHERE id = ?');
  const getItem = db.prepare('SELECT * FROM items WHERE id = ?');

  // Everything the admin page needs, inactive entries included.
  app.get('/api/admin/menu', async () => ({
    categories: db.prepare('SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY sort_order, id').all().map(cat),
    items: db.prepare('SELECT * FROM items WHERE deleted_at IS NULL ORDER BY sort_order, id').all().map(item),
    modifiers: db.prepare('SELECT * FROM modifiers WHERE deleted_at IS NULL ORDER BY sort_order, id').all().map((m) => mapBools(m, ['active'])),
  }));

  // --- categories ---
  app.post(
    '/api/admin/categories',
    { schema: { body: { type: 'object', required: ['name'], properties: { name: nameSchema } } } },
    async (req, reply) => {
      const { name } = cleanBody(req.body);
      const { lastInsertRowid } = db
        .prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)')
        .run(name, nextSort(db, 'categories'));
      return reply.code(201).send(cat(getCat.get(lastInsertRowid)));
    },
  );

  app.put('/api/admin/categories/order', { schema: orderSchema }, async (req, reply) => {
    reorder(db, 'categories', req.body.ids);
    return reply.code(204).send();
  });

  app.patch(
    '/api/admin/categories/:id',
    { schema: { params: idParams, body: { type: 'object', properties: { name: nameSchema, active: bool } } } },
    async (req) => {
      patchRow(db, 'categories', req.params.id, cleanBody(req.body), ['name', 'active']);
      return cat(getCat.get(req.params.id));
    },
  );

  // --- items ---
  app.post(
    '/api/admin/items',
    {
      schema: {
        body: {
          type: 'object',
          required: ['category_id', 'name', 'price_cents'],
          properties: { category_id: { type: 'integer' }, name: nameSchema, price_cents: price },
        },
      },
    },
    async (req, reply) => {
      const { category_id, name, price_cents } = cleanBody(req.body);
      const { lastInsertRowid } = db
        .prepare('INSERT INTO items (category_id, name, price_cents, sort_order) VALUES (?, ?, ?, ?)')
        .run(category_id, name, price_cents, nextSort(db, 'items', 'category_id = ?', category_id));
      return reply.code(201).send(item(getItem.get(lastInsertRowid)));
    },
  );

  app.put('/api/admin/items/order', { schema: orderSchema }, async (req, reply) => {
    reorder(db, 'items', req.body.ids);
    return reply.code(204).send();
  });

  app.patch(
    '/api/admin/items/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          properties: {
            category_id: { type: 'integer' },
            name: nameSchema,
            price_cents: price,
            active: bool,
            sold_out: bool,
          },
        },
      },
    },
    async (req) => {
      patchRow(db, 'items', req.params.id, cleanBody(req.body), ['category_id', 'name', 'price_cents', 'active', 'sold_out']);
      return item(getItem.get(req.params.id));
    },
  );
}
