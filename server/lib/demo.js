// Sample data for a first try of the app. Only added to an empty database.

const DEMO = {
  it: {
    operators: ['Anna', 'Paolo'],
    categories: [
      { name: 'Caffetteria', items: [['Caffè', 120], ['Cappuccino', 150], ['Specialty coffee', 250]],
        modifiers: [['Latte di soia', 30], ['Decaffeinato', 0], ['Ben caldo', 0]] },
      { name: 'Bibite', items: [['Acqua', 150], ['Coca-Cola', 300], ['Birra', 450]], modifiers: [['Senza ghiaccio', 0]] },
      { name: 'Aperitivi', items: [['Spritz', 500], ['Prosecco', 400]], modifiers: [['Con olive', 0]] },
      { name: 'Snack', items: [['Toast', 400], ['Tramezzino', 300]], modifiers: [['Senza glutine', 100]] },
    ],
  },
  en: {
    operators: ['Anna', 'Paul'],
    categories: [
      { name: 'Coffee', items: [['Espresso', 120], ['Cappuccino', 150], ['Specialty coffee', 250]],
        modifiers: [['Soy milk', 30], ['Decaf', 0], ['Extra hot', 0]] },
      { name: 'Drinks', items: [['Water', 150], ['Cola', 300], ['Beer', 450]], modifiers: [['No ice', 0]] },
      { name: 'Aperitifs', items: [['Spritz', 500], ['Prosecco', 400]], modifiers: [['With olives', 0]] },
      { name: 'Snacks', items: [['Toastie', 400], ['Sandwich', 300]], modifiers: [['Gluten free', 100]] },
    ],
  },
};

// Returns false (and changes nothing) when the database already has operators or menu items.
// Goes through the admin API, so the PIN must be off: the demo script builds the app without it.
export async function seedDemo(app) {
  const count = (sql) => app.db.prepare(sql).get().n;
  if (count('SELECT COUNT(*) AS n FROM operators') + count('SELECT COUNT(*) AS n FROM items WHERE is_custom = 0') > 0) {
    return false;
  }
  const post = async (url, payload) => {
    const res = await app.inject({ method: 'POST', url, payload });
    if (res.statusCode >= 300) throw new Error(`${url}: ${res.statusCode} ${res.body}`);
    return res.json();
  };

  const data = DEMO[app.i18n.language] ?? DEMO.en;
  for (const name of data.operators) await post('/api/admin/operators', { name });
  for (const c of data.categories) {
    const category = await post('/api/admin/categories', { name: c.name });
    for (const [name, price_cents] of c.items) await post('/api/admin/items', { category_id: category.id, name, price_cents });
    for (const [name, price_cents] of c.modifiers) await post('/api/admin/modifiers', { category_id: category.id, name, price_cents });
  }
  return true;
}
