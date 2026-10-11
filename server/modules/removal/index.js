import { idParams } from '../../db/helpers.js';
import { httpError } from '../../lib/errors.js';

// "Delete" never removes rows: past orders and statistics still point to them.
// The row is stamped with deleted_at and disappears from every list.
// Deleting a category or an item takes the things inside it along.
export default async function removal(app) {
  const { db } = app;
  const stamp = (table, where) =>
    db.prepare(`UPDATE ${table} SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE ${where} AND deleted_at IS NULL`);

  const stmt = {
    operator: stamp('operators', 'id = ?'),
    modifier: stamp('modifiers', 'id = ?'),
    item: stamp('items', 'id = ?'),
    itemNotes: stamp('modifiers', 'item_id = ?'),
    category: stamp('categories', 'id = ?'),
    categoryItemNotes: stamp('modifiers', 'item_id IN (SELECT id FROM items WHERE category_id = ?)'),
    categoryItems: stamp('items', 'category_id = ?'),
    categoryNotes: stamp('modifiers', 'category_id = ?'),
  };

  // The first step is the thing being deleted (404 if missing), the rest are cascades.
  const route = (path, steps) =>
    app.delete(path, { schema: { params: idParams } }, async (req, reply) => {
      const [first, ...cascade] = steps;
      db.transaction(() => {
        if (!stmt[first].run(req.params.id).changes) throw httpError(404, 'not found');
        for (const step of cascade) stmt[step].run(req.params.id);
      })();
      return reply.code(204).send();
    });

  route('/api/admin/operators/:id', ['operator']);
  route('/api/admin/modifiers/:id', ['modifier']);
  route('/api/admin/items/:id', ['item', 'itemNotes']);
  route('/api/admin/categories/:id', ['category', 'categoryItemNotes', 'categoryItems', 'categoryNotes']);
}
