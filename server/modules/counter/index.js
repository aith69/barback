import { idParams } from '../../db/helpers.js';
import { createCounterService } from './service.js';

const tableParams = { type: 'object', properties: { number: { type: 'integer' } } };

export default async function counter(app) {
  const svc = createCounterService(app.db);

  app.get('/api/counter/queue', async () => svc.queue());
  app.get('/api/counter/tables', async () => svc.openTables());

  app.put(
    '/api/counter/lines/:id/status',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['status'],
          properties: { status: { type: 'string', enum: ['new', 'prepared'] } },
        },
      },
    },
    async (req, reply) => {
      svc.setLineStatus(req.params.id, req.body.status);
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/counter/tables/:number/prepared',
    {
      schema: {
        params: tableParams,
        body: { type: 'object', required: ['prepared'], properties: { prepared: { type: 'boolean' } } },
      },
    },
    async (req, reply) => {
      svc.setTablePrepared(req.params.number, req.body.prepared);
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/counter/tables/:number/close',
    {
      schema: {
        params: tableParams,
        body: {
          type: 'object',
          required: ['operator_id', 'total_paid_cents'],
          properties: {
            operator_id: { type: 'integer' },
            total_paid_cents: { type: 'integer', minimum: 0, maximum: 10000000 },
          },
        },
      },
    },
    async (req) => svc.closeTable(req.params.number, req.body.operator_id, req.body.total_paid_cents),
  );
}
