// Read-only data for the waiter app: who can log in, and what can be ordered.
export default async function catalog(app) {
  const { db } = app;

  app.get('/api/operators', async () =>
    db.prepare('SELECT id, name FROM operators WHERE active = 1 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE').all());

  // Active menu. Each item carries its quick notes: the category's first, then its own.
  app.get('/api/menu', async () => {
    const categories = db.prepare('SELECT id, name FROM categories WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order, id').all();
    const items = db
      .prepare('SELECT id, category_id, name, price_cents, sold_out FROM items WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order, id')
      .all();
    const notes = db.prepare('SELECT id, category_id, item_id, name, price_cents, required FROM modifiers WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order, id').all();
    const pick = ({ id, name, price_cents, required }) => ({ id, name, price_cents, required: Boolean(required) });

    return {
      categories: categories.map((c) => {
        const categoryNotes = notes.filter((m) => m.category_id === c.id).map(pick);
        return {
          ...c,
          items: items
            .filter((i) => i.category_id === c.id)
            .map((i) => ({
              id: i.id,
              name: i.name,
              price_cents: i.price_cents,
              sold_out: Boolean(i.sold_out),
              modifiers: [...categoryNotes, ...notes.filter((m) => m.item_id === i.id).map(pick)],
            })),
        };
      }),
    };
  });
}
