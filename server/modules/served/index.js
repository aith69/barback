import { httpError } from '../../lib/errors.js';

// "Served": a waiter took the prepared lines of a table to the customers.
// It is a mark on the lines, so a second round on the same table starts fresh.
export default async function served(app) {
  const { db } = app;
  const openOrder = db.prepare("SELECT id FROM orders WHERE table_number = ? AND status = 'open'");
  const serve = db.prepare(
    `UPDATE order_lines SET served_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE order_id = ? AND status = 'prepared' AND served_at IS NULL AND removed_at IS NULL`,
  );
  const unserve = db.prepare(
    'UPDATE order_lines SET served_at = NULL WHERE order_id = ? AND served_at IS NOT NULL AND removed_at IS NULL',
  );

  app.post(
    '/api/tables/:number/served',
    {
      schema: {
        params: { type: 'object', properties: { number: { type: 'integer' } } },
        body: { type: 'object', required: ['served'], properties: { served: { type: 'boolean' } } },
      },
    },
    async (req, reply) => {
      const order = openOrder.get(req.params.number);
      if (!order) throw httpError(404, 'no open order on this table');
      (req.body.served ? serve : unserve).run(order.id);
      return reply.code(204).send();
    },
  );
}
