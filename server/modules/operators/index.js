import { cleanBody, idParams, mapBools, nameSchema, patchRow } from '../../db/helpers.js';

// Operators are the people using the app (waiters, counter). No password:
// they pick their name, and it is recorded on what they do.
export default async function operators(app) {
  const { db } = app;
  const get = db.prepare('SELECT * FROM operators WHERE id = ?');
  const out = (row) => mapBools(row, ['active']);

  app.get('/api/admin/operators', async () =>
    db.prepare('SELECT * FROM operators ORDER BY name COLLATE NOCASE').all().map(out));

  app.post(
    '/api/admin/operators',
    { schema: { body: { type: 'object', required: ['name'], properties: { name: nameSchema } } } },
    async (req, reply) => {
      const { name } = cleanBody(req.body);
      const { lastInsertRowid } = db.prepare('INSERT INTO operators (name) VALUES (?)').run(name);
      return reply.code(201).send(out(get.get(lastInsertRowid)));
    },
  );

  app.patch(
    '/api/admin/operators/:id',
    {
      schema: {
        params: idParams,
        body: { type: 'object', properties: { name: nameSchema, active: { type: 'boolean' } } },
      },
    },
    async (req) => {
      patchRow(db, 'operators', req.params.id, cleanBody(req.body), ['name', 'active']);
      return out(get.get(req.params.id));
    },
  );
}
