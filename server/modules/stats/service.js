// Sales statistics. Only closed orders count, on the day they were closed (local time).
// SQLite cannot split days by time zone, so rows are read with a one-day margin and
// grouped here: a small bar closes a few hundred orders a day at most.

const DAY = 86_400_000;

const dateMs = (date) => Date.parse(`${date}T00:00:00Z`);
export const addDays = (date, n) => new Date(dateMs(date) + n * DAY).toISOString().slice(0, 10);
const weekStart = (date) => addDays(date, -((new Date(dateMs(date)).getUTCDay() + 6) % 7)); // Monday
const periodOf = { day: (d) => d, week: weekStart, month: (d) => d.slice(0, 7) };
const byQuantity = (a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name);

export function isDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = dateMs(s);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}

export function createStatsService(db, { timezone }) {
  const format = (options) => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', ...options });
    } catch {
      throw new Error(`Invalid timezone "${timezone}" in the configuration`);
    }
  };
  const dayFormat = format({ year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeFormat = format({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const parts = (fmt, iso) => Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  const localDate = (iso) => {
    const p = parts(dayFormat, iso);
    return `${p.year}-${p.month}-${p.day}`;
  };
  const localDateTime = (iso) => {
    const p = parts(timeFormat, iso);
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  };

  // UTC bounds wide enough to contain the local days from..to whatever the time zone.
  const bounds = (from, to) => [new Date(dateMs(from) - DAY).toISOString(), new Date(dateMs(to) + 2 * DAY).toISOString()];
  const inRange = (iso, from, to) => {
    const d = localDate(iso);
    return d >= from && d <= to;
  };

  const q = {
    orders: db.prepare(
      `SELECT o.id, o.table_number, o.closed_at, o.subtotal_cents, o.adjustment_cents, o.total_paid_cents,
              ob.name AS opened_by, cb.name AS closed_by
       FROM orders o
       LEFT JOIN operators ob ON ob.id = o.opened_by
       LEFT JOIN operators cb ON cb.id = o.closed_by
       WHERE o.status = 'closed' AND o.closed_at >= ? AND o.closed_at < ?
       ORDER BY o.closed_at`,
    ),
    lines: db.prepare(
      `SELECT l.item_name, l.quantity, l.unit_price_cents, i.id AS item_id, i.name AS current_name, i.is_custom,
              c.name AS category, o.closed_at
       FROM order_lines l
       JOIN orders o ON o.id = l.order_id
       JOIN items i ON i.id = l.item_id
       JOIN categories c ON c.id = i.category_id
       WHERE o.status = 'closed' AND l.removed_at IS NULL AND o.closed_at >= ? AND o.closed_at < ?`,
    ),
    modifiers: db.prepare(
      `SELECT m.modifier_name, m.price_cents, l.quantity, i.name AS item_name, o.closed_at
       FROM order_line_modifiers m
       JOIN order_lines l ON l.id = m.order_line_id
       JOIN orders o ON o.id = l.order_id
       JOIN items i ON i.id = l.item_id
       WHERE o.status = 'closed' AND l.removed_at IS NULL AND o.closed_at >= ? AND o.closed_at < ?`,
    ),
  };

  const closedOrders = (from, to) =>
    q.orders.all(...bounds(from, to)).filter((o) => inRange(o.closed_at, from, to)).map((o) => ({ ...o, date: localDate(o.closed_at) }));

  return {
    today: () => localDate(new Date().toISOString()),

    // One row per day, week (starting Monday) or month, with sales. Periods without sales are left out.
    revenue(from, to, group = 'day') {
      const key = periodOf[group];
      const rows = new Map();
      for (const o of closedOrders(from, to)) {
        const period = key(o.date);
        const r = rows.get(period) ?? { period, orders: 0, subtotal_cents: 0, adjustment_cents: 0, paid_cents: 0 };
        r.orders += 1;
        r.subtotal_cents += o.subtotal_cents;
        r.adjustment_cents += o.adjustment_cents;
        r.paid_cents += o.total_paid_cents;
        rows.set(period, r);
      }
      const list = [...rows.values()].sort((a, b) => a.period.localeCompare(b.period));
      const totals = list.reduce(
        (sum, r) => ({
          orders: sum.orders + r.orders,
          subtotal_cents: sum.subtotal_cents + r.subtotal_cents,
          adjustment_cents: sum.adjustment_cents + r.adjustment_cents,
          paid_cents: sum.paid_cents + r.paid_cents,
        }),
        { orders: 0, subtotal_cents: 0, adjustment_cents: 0, paid_cents: 0 },
      );
      return { group, from, to, rows: list, totals };
    },

    // Every closed order, for the CSV export.
    orders(from, to) {
      return closedOrders(from, to).map((o) => ({ ...o, closed_local: localDateTime(o.closed_at) }));
    },

    // Menu items, and apart the custom text-only requests (grouped by what was typed).
    products(from, to) {
      const items = new Map();
      const custom = new Map();
      for (const l of q.lines.all(...bounds(from, to))) {
        if (!inRange(l.closed_at, from, to)) continue;
        const value = l.quantity * l.unit_price_cents;
        if (l.is_custom) {
          const name = l.item_name.trim();
          const r = custom.get(name.toLowerCase()) ?? { name, quantity: 0, revenue_cents: 0 };
          r.quantity += l.quantity;
          r.revenue_cents += value;
          custom.set(name.toLowerCase(), r);
        } else {
          const r = items.get(l.item_id) ?? { item_id: l.item_id, name: l.current_name, category: l.category, quantity: 0, revenue_cents: 0 };
          r.quantity += l.quantity;
          r.revenue_cents += value;
          items.set(l.item_id, r);
        }
      }
      return { from, to, items: [...items.values()].sort(byQuantity), custom: [...custom.values()].sort(byQuantity) };
    },

    // Quick notes only (free text is not counted), per unit, with the products they were asked on.
    modifiers(from, to) {
      const map = new Map();
      for (const m of q.modifiers.all(...bounds(from, to))) {
        if (!inRange(m.closed_at, from, to)) continue;
        const r = map.get(m.modifier_name) ?? { name: m.modifier_name, quantity: 0, revenue_cents: 0, items: new Map() };
        r.quantity += m.quantity;
        r.revenue_cents += m.quantity * m.price_cents;
        r.items.set(m.item_name, (r.items.get(m.item_name) ?? 0) + m.quantity);
        map.set(m.modifier_name, r);
      }
      const modifiers = [...map.values()]
        .map((r) => ({
          name: r.name,
          quantity: r.quantity,
          revenue_cents: r.revenue_cents,
          items: [...r.items].map(([name, quantity]) => ({ name, quantity })).sort(byQuantity),
        }))
        .sort(byQuantity);
      return { from, to, modifiers };
    },
  };
}
