import { csvFormat, toCsv } from '../../lib/csv.js';
import { httpError } from '../../lib/errors.js';
import { addDays, createStatsService, isDate } from './service.js';

const MAX_DAYS = 1830; // about five years
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const group = { type: 'string', enum: ['day', 'week', 'month'] };
const range = { from: date, to: date, group };

// Default period: the last 30 days up to today (in the configured time zone).
function parseRange(query, svc) {
  const to = query.to ?? svc.today();
  if (!isDate(to)) throw httpError(400, 'invalid date');
  const from = query.from ?? addDays(to, -29);
  if (!isDate(from)) throw httpError(400, 'invalid date');
  if (from > to) throw httpError(400, 'from is after to');
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > MAX_DAYS * 86_400_000) {
    throw httpError(400, 'range too long');
  }
  return { from, to };
}

// All routes are under /api/stats/: the shared PIN protects them (see modules/auth).
export default async function stats(app) {
  const svc = createStatsService(app.db, app.config);
  const t = app.i18n.t;
  const querystring = { type: 'object', properties: range };

  app.get('/api/stats/revenue', { schema: { querystring } }, async (req) => {
    const { from, to } = parseRange(req.query, svc);
    return svc.revenue(from, to, req.query.group ?? 'day');
  });

  app.get('/api/stats/products', { schema: { querystring } }, async (req) => {
    const { from, to } = parseRange(req.query, svc);
    return svc.products(from, to);
  });

  const col = (key) => t(`stats.col.${key}`);
  function csvRows(kind, from, to, groupBy) {
    switch (kind) {
      case 'revenue':
        return [
          [col('period'), col('orders'), col('subtotal'), col('adjustment'), col('paid')],
          ...svc.revenue(from, to, groupBy).rows.map((r) => [
            r.period, r.orders, { cents: r.subtotal_cents }, { cents: r.adjustment_cents }, { cents: r.paid_cents },
          ]),
        ];
      case 'orders':
        return [
          [col('date'), col('table'), col('openedBy'), col('closedBy'), col('subtotal'), col('adjustment'), col('paid')],
          ...svc.orders(from, to).map((o) => [
            o.closed_local, o.table_number, o.opened_by ?? '', o.closed_by ?? '',
            { cents: o.subtotal_cents }, { cents: o.adjustment_cents }, { cents: o.total_paid_cents },
          ]),
        ];
      case 'products': {
        const rows = [[col('name'), col('category'), col('type'), col('detail'), col('quantity'), col('revenue')]];
        for (const x of svc.products(from, to).items) {
          rows.push([x.name, x.category, t('stats.type.product'), '', x.quantity, { cents: x.revenue_cents }]);
          for (const v of x.variants) rows.push([x.name, x.category, t('stats.type.variant'), v.name, v.quantity, { cents: v.revenue_cents }]);
          for (const n of x.notes) rows.push([x.name, x.category, t('stats.type.note'), n.name, n.quantity, { cents: n.revenue_cents }]);
        }
        return rows;
      }
      default: // custom
        return [
          [col('name'), col('quantity'), col('revenue')],
          ...svc.products(from, to).custom.map((x) => [x.name, x.quantity, { cents: x.revenue_cents }]),
        ];
    }
  }

  app.get(
    '/api/stats/export.csv',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['kind'],
          properties: { ...range, kind: { type: 'string', enum: ['revenue', 'orders', 'products', 'custom'] } },
        },
      },
    },
    async (req, reply) => {
      const { from, to } = parseRange(req.query, svc);
      const { kind } = req.query;
      const body = toCsv(csvRows(kind, from, to, req.query.group ?? 'day'), csvFormat(app.i18n.language));
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="barback-${kind}-${from}_${to}.csv"`)
        .send(body);
    },
  );
}
