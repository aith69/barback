import { idParams } from '../../db/helpers.js';
import { createOrderService } from './service.js';

const tableParams = { type: 'object', properties: { number: { type: 'integer' } } };
const operatorId = { type: 'integer' };
const quantity = { type: 'integer', minimum: 1, maximum: 99 };
const note = { type: 'string', maxLength: 200 };
const noteIds = { type: 'array', items: { type: 'integer' }, maxItems: 20 };
const cents = { type: 'integer', minimum: 0, maximum: 1000000 };

// A line is a catalog item (item_id) or a custom text-only item (custom_name).
const newLine = {
  type: 'object',
  required: ['quantity'],
  properties: {
    item_id: { type: 'integer' },
    custom_name: { type: 'string', maxLength: 80 },
    quantity,
    note,
    note_price_cents: cents,
    modifier_ids: noteIds,
  },
};

export default async function orders(app) {
  const svc = createOrderService(app.db, app.config);

  app.get('/api/tables', async () => svc.tables());

  app.get('/api/tables/:number', { schema: { params: tableParams } }, async (req) => svc.tableDetail(req.params.number));

  app.post(
    '/api/tables/:number/lines',
    {
      schema: {
        params: tableParams,
        body: {
          type: 'object',
          required: ['operator_id', 'lines'],
          properties: { operator_id: operatorId, lines: { type: 'array', minItems: 1, maxItems: 50, items: newLine } },
        },
      },
    },
    async (req, reply) =>
      reply.code(201).send(svc.addLines(req.params.number, req.body.operator_id, req.body.lines)),
  );

  app.patch(
    '/api/lines/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['operator_id'],
          properties: { operator_id: operatorId, quantity, note, note_price_cents: cents, modifier_ids: noteIds },
        },
      },
    },
    async (req) => {
      const { operator_id, ...changes } = req.body;
      return svc.updateLine(req.params.id, operator_id, changes);
    },
  );

  // Price of a custom item, set at the counter or at the cash register.
  app.put(
    '/api/lines/:id/price',
    {
      schema: {
        params: idParams,
        body: { type: 'object', required: ['price_cents'], properties: { price_cents: cents } },
      },
    },
    async (req) => svc.setPrice(req.params.id, req.body.price_cents),
  );

  app.delete(
    '/api/lines/:id',
    {
      schema: {
        params: idParams,
        querystring: { type: 'object', required: ['operator_id'], properties: { operator_id: operatorId } },
      },
    },
    async (req) => svc.removeLine(req.params.id, req.query.operator_id),
  );
}
