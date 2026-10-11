import { httpError } from '../../lib/errors.js';

const cleanNote = (note) => (note == null ? null : String(note).trim() || null);

// All order rules live here, so routes stay thin and other modules can reuse them.
export function createOrderService(db, config) {
  const q = {
    openOrder: db.prepare("SELECT * FROM orders WHERE table_number = ? AND status = 'open'"),
    orderById: db.prepare(
      'SELECT o.*, op.name AS opened_by_name FROM orders o LEFT JOIN operators op ON op.id = o.opened_by WHERE o.id = ?',
    ),
    insertOrder: db.prepare('INSERT INTO orders (table_number, opened_by) VALUES (?, ?)'),
    operator: db.prepare('SELECT id FROM operators WHERE id = ? AND active = 1'),
    item: db.prepare(
      'SELECT i.*, c.active AS category_active FROM items i JOIN categories c ON c.id = i.category_id WHERE i.id = ?',
    ),
    allowedNotes: db.prepare('SELECT id, name FROM modifiers WHERE active = 1 AND (item_id = @item OR category_id = @category)'),
    currentNotes: db.prepare('SELECT modifier_id AS id, modifier_name AS name FROM order_line_modifiers WHERE order_line_id = ?'),
    insertLine: db.prepare(
      'INSERT INTO order_lines (order_id, item_id, item_name, quantity, unit_price_cents, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    insertLineNote: db.prepare('INSERT INTO order_line_modifiers (order_line_id, modifier_id, modifier_name) VALUES (?, ?, ?)'),
    deleteLineNotes: db.prepare('DELETE FROM order_line_modifiers WHERE order_line_id = ?'),
    line: db.prepare('SELECT l.*, o.status AS order_status FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.id = ?'),
    setQuantity: db.prepare('UPDATE order_lines SET quantity = ? WHERE id = ?'),
    setNote: db.prepare('UPDATE order_lines SET note = ? WHERE id = ?'),
    softDelete: db.prepare("UPDATE order_lines SET removed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), removed_by = ? WHERE id = ?"),
    recalc: db.prepare(
      `UPDATE orders SET subtotal_cents = (
         SELECT COALESCE(SUM(quantity * unit_price_cents), 0) FROM order_lines WHERE order_id = @id AND removed_at IS NULL
       ) WHERE id = @id`,
    ),
    lines: db.prepare(
      `SELECT l.id, l.item_id, l.item_name, l.quantity, l.unit_price_cents, l.note, l.status, l.created_at, op.name AS created_by
       FROM order_lines l LEFT JOIN operators op ON op.id = l.created_by
       WHERE l.order_id = ? AND l.removed_at IS NULL ORDER BY l.id`,
    ),
    lineNotes: db.prepare(
      `SELECT m.order_line_id, m.modifier_id, m.modifier_name AS name
       FROM order_line_modifiers m JOIN order_lines l ON l.id = m.order_line_id
       WHERE l.order_id = ? AND l.removed_at IS NULL ORDER BY m.rowid`,
    ),
    openSummary: db.prepare(
      `SELECT o.table_number AS number,
              SUM(CASE WHEN l.status = 'new' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN l.status = 'prepared' THEN 1 ELSE 0 END) AS prepared
       FROM orders o LEFT JOIN order_lines l ON l.order_id = o.id AND l.removed_at IS NULL
       WHERE o.status = 'open' GROUP BY o.id`,
    ),
  };

  const assertTable = (n) => {
    if (!Number.isInteger(n) || n < 1 || n > config.maxTables) throw httpError(404, 'unknown table');
  };
  const assertOperator = (id) => {
    if (!q.operator.get(id)) throw httpError(400, 'unknown operator');
  };
  const recalc = (orderId) => q.recalc.run({ id: orderId });

  // Quick notes must be active and belong to the item or its category.
  // Notes already on the line stay valid even if they were deactivated since.
  function resolveNotes(item, ids, existing = new Map()) {
    const allowed = new Map(q.allowedNotes.all({ item: item.id, category: item.category_id }).map((m) => [m.id, m]));
    return [...new Set(ids)].map((id) => {
      const note = allowed.get(id) ?? existing.get(id);
      if (!note) throw httpError(400, 'invalid quick note');
      return note;
    });
  }

  function insertLine(orderId, operatorId, { item_id, quantity, note, modifier_ids = [] }) {
    const item = q.item.get(item_id);
    if (!item || !item.active || !item.category_active) throw httpError(400, 'unknown item');
    if (item.sold_out) throw httpError(409, 'item sold out');
    const notes = resolveNotes(item, modifier_ids);
    const { lastInsertRowid } = q.insertLine.run(orderId, item.id, item.name, quantity, item.price_cents, cleanNote(note), operatorId);
    for (const n of notes) q.insertLineNote.run(lastInsertRowid, n.id, n.name);
  }

  function orderView(orderId) {
    const order = q.orderById.get(orderId);
    const notes = new Map();
    for (const m of q.lineNotes.all(orderId)) {
      if (!notes.has(m.order_line_id)) notes.set(m.order_line_id, []);
      notes.get(m.order_line_id).push({ id: m.modifier_id, name: m.name });
    }
    const lines = q.lines.all(orderId).map((l) => ({ ...l, modifiers: notes.get(l.id) ?? [] }));
    return {
      id: order.id,
      table_number: order.table_number,
      status: order.status,
      opened_by: order.opened_by_name,
      opened_at: order.opened_at,
      subtotal_cents: lines.reduce((sum, l) => sum + l.quantity * l.unit_price_cents, 0),
      lines,
    };
  }

  const detail = (orderId) => {
    const order = orderView(orderId);
    return { number: order.table_number, order };
  };

  function editableLine(lineId) {
    const line = q.line.get(lineId);
    if (!line || line.removed_at) throw httpError(404, 'unknown line');
    if (line.order_status !== 'open') throw httpError(409, 'order is closed');
    return line;
  }

  return {
    tables() {
      const open = new Map(q.openSummary.all().map((r) => [r.number, r]));
      return Array.from({ length: config.maxTables }, (_, i) => {
        const r = open.get(i + 1);
        return { number: i + 1, occupied: Boolean(r), pending: r?.pending ?? 0, prepared: r?.prepared ?? 0 };
      });
    },

    tableDetail(number) {
      assertTable(number);
      const open = q.openOrder.get(number);
      return { number, order: open ? orderView(open.id) : null };
    },

    // Creates the order on first use. All-or-nothing: one bad line rejects the batch.
    addLines(number, operatorId, lines) {
      assertTable(number);
      assertOperator(operatorId);
      const orderId = db.transaction(() => {
        const open = q.openOrder.get(number);
        const id = open ? open.id : Number(q.insertOrder.run(number, operatorId).lastInsertRowid);
        for (const line of lines) insertLine(id, operatorId, line);
        recalc(id);
        return id;
      })();
      return detail(orderId);
    },

    updateLine(lineId, operatorId, { quantity, note, modifier_ids }) {
      assertOperator(operatorId);
      const line = editableLine(lineId);
      db.transaction(() => {
        if (quantity !== undefined) q.setQuantity.run(quantity, lineId);
        if (note !== undefined) q.setNote.run(cleanNote(note), lineId);
        if (modifier_ids !== undefined) {
          const existing = new Map(q.currentNotes.all(lineId).map((m) => [m.id, m]));
          const notes = resolveNotes(q.item.get(line.item_id), modifier_ids, existing);
          q.deleteLineNotes.run(lineId);
          for (const n of notes) q.insertLineNote.run(lineId, n.id, n.name);
        }
        recalc(line.order_id);
      })();
      return detail(line.order_id);
    },

    // Soft delete: the row stays, with who removed it and when.
    removeLine(lineId, operatorId) {
      assertOperator(operatorId);
      const line = editableLine(lineId);
      db.transaction(() => {
        q.softDelete.run(operatorId, lineId);
        recalc(line.order_id);
      })();
      return detail(line.order_id);
    },
  };
}
