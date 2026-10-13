import { httpError } from '../../lib/errors.js';

// Counter and cash register: preparation queue, open tables with totals, closing a table.
// A table with custom items that still have no price cannot be prepared nor closed.
export function createCounterService(db) {
  const q = {
    queueLines: db.prepare(
      `SELECT o.id AS order_id, o.table_number, o.opened_at,
              l.id, l.item_name, l.quantity, l.note, l.status, l.price_pending, l.served_at, l.created_at, op.name AS created_by
       FROM orders o
       JOIN order_lines l ON l.order_id = o.id AND l.removed_at IS NULL
       LEFT JOIN operators op ON op.id = l.created_by
       WHERE o.status = 'open' ORDER BY o.table_number, l.id`,
    ),
    queueNotes: db.prepare(
      `SELECT m.order_line_id, m.modifier_name AS name
       FROM order_line_modifiers m
       JOIN order_lines l ON l.id = m.order_line_id
       JOIN orders o ON o.id = l.order_id
       WHERE o.status = 'open' AND l.removed_at IS NULL ORDER BY m.rowid`,
    ),
    openTables: db.prepare(
      `SELECT o.id AS order_id, o.table_number AS number, o.opened_at,
              COALESCE(SUM(l.quantity * l.unit_price_cents), 0) AS subtotal_cents,
              COUNT(l.id) AS lines,
              SUM(CASE WHEN l.status = 'new' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN l.price_pending = 1 THEN 1 ELSE 0 END) AS unpriced
       FROM orders o LEFT JOIN order_lines l ON l.order_id = o.id AND l.removed_at IS NULL
       WHERE o.status = 'open' GROUP BY o.id ORDER BY o.table_number`,
    ),
    getLine: db.prepare(
      `SELECT id, price_pending FROM order_lines
       WHERE id = ? AND removed_at IS NULL AND order_id IN (SELECT id FROM orders WHERE status = 'open')`,
    ),
    setLine: db.prepare('UPDATE order_lines SET status = ?, served_at = NULL WHERE id = ?'),
    openOrder: db.prepare("SELECT id FROM orders WHERE table_number = ? AND status = 'open'"),
    setTable: db.prepare(
      'UPDATE order_lines SET status = @to, served_at = NULL WHERE order_id = @order AND status = @from AND removed_at IS NULL',
    ),
    unpriced: db.prepare(
      'SELECT COUNT(*) AS n FROM order_lines WHERE order_id = ? AND price_pending = 1 AND removed_at IS NULL',
    ),
    subtotal: db.prepare(
      'SELECT COALESCE(SUM(quantity * unit_price_cents), 0) AS total FROM order_lines WHERE order_id = ? AND removed_at IS NULL',
    ),
    close: db.prepare(
      `UPDATE orders SET status = 'closed', closed_by = @operator,
         closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         subtotal_cents = @subtotal, adjustment_cents = @adjustment, total_paid_cents = @paid
       WHERE id = @id`,
    ),
    operator: db.prepare('SELECT id FROM operators WHERE id = ? AND active = 1 AND deleted_at IS NULL'),
  };

  const assertPriced = (orderId) => {
    if (q.unpriced.get(orderId).n) throw httpError(409, 'price missing');
  };

  return {
    // Open tables with their (non-removed) lines, quick notes included.
    queue() {
      const notes = new Map();
      for (const m of q.queueNotes.all()) {
        if (!notes.has(m.order_line_id)) notes.set(m.order_line_id, []);
        notes.get(m.order_line_id).push({ name: m.name });
      }
      const tables = new Map();
      for (const r of q.queueLines.all()) {
        if (!tables.has(r.order_id)) {
          tables.set(r.order_id, { order_id: r.order_id, table: r.table_number, opened_at: r.opened_at, lines: [] });
        }
        tables.get(r.order_id).lines.push({
          id: r.id,
          item_name: r.item_name,
          quantity: r.quantity,
          note: r.note,
          status: r.status,
          price_pending: Boolean(r.price_pending),
          served_at: r.served_at,
          created_at: r.created_at,
          created_by: r.created_by,
          modifiers: notes.get(r.id) ?? [],
        });
      }
      return [...tables.values()];
    },

    openTables() {
      return q.openTables.all().map((r) => ({ ...r, pending: r.pending ?? 0, unpriced: r.unpriced ?? 0 }));
    },

    // A custom item cannot be marked prepared until it has a price.
    setLineStatus(lineId, status) {
      const line = q.getLine.get(lineId);
      if (!line) throw httpError(404, 'unknown line');
      if (status === 'prepared' && line.price_pending) throw httpError(409, 'price missing');
      q.setLine.run(status, lineId);
    },

    // prepared=true: new -> prepared. prepared=false (undo): prepared -> new.
    setTablePrepared(number, prepared) {
      const order = q.openOrder.get(number);
      if (!order) throw httpError(404, 'no open order on this table');
      if (prepared) assertPriced(order.id);
      q.setTable.run({ order: order.id, from: prepared ? 'new' : 'prepared', to: prepared ? 'prepared' : 'new' });
    },

    // The adjustment (discount or rounding, signed) is whatever makes the subtotal equal what was paid.
    closeTable(number, operatorId, paid) {
      if (!q.operator.get(operatorId)) throw httpError(400, 'unknown operator');
      return db.transaction(() => {
        const order = q.openOrder.get(number);
        if (!order) throw httpError(404, 'no open order on this table');
        assertPriced(order.id);
        const subtotal = q.subtotal.get(order.id).total;
        const adjustment = paid - subtotal;
        q.close.run({ id: order.id, operator: operatorId, subtotal, adjustment, paid });
        return { number, order_id: order.id, subtotal_cents: subtotal, adjustment_cents: adjustment, total_paid_cents: paid };
      })();
    },
  };
}
