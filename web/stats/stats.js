import { loadI18n, t } from '/shared/i18n.js';
import { api } from '/shared/api.js';
import { h } from '/shared/dom.js';
import { requirePin } from '/shared/pin.js';
import { formatMoney } from '/shared/money.js';

const app = document.getElementById('app');
let language = 'en';
let currency = 'EUR';

const money = (cents) => formatMoney(cents, language, currency);
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const presets = {
  today: () => ({ from: iso(new Date()), to: iso(new Date()), group: 'day' }),
  week: () => ({ from: iso(daysAgo((new Date().getDay() + 6) % 7)), to: iso(new Date()), group: 'day' }),
  month: () => {
    const d = new Date();
    return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(d), group: 'day' };
  },
  last30: () => ({ from: iso(daysAgo(29)), to: iso(new Date()), group: 'day' }),
  year: () => {
    const d = new Date();
    return { from: iso(new Date(d.getFullYear(), d.getMonth() - 11, 1)), to: iso(d), group: 'month' };
  },
};

let range = presets.week();
const results = h('div');

const at = (date) => new Date(`${date}T12:00:00`); // noon: no day shift whatever the time zone
const periodLabel = (period, group) => {
  if (group === 'month') return at(`${period}-01`).toLocaleDateString(language, { month: 'long', year: 'numeric' });
  if (group === 'week') return t('stats.weekOf', { date: at(period).toLocaleDateString(language, { day: 'numeric', month: 'short' }) });
  return at(period).toLocaleDateString(language, { weekday: 'short', day: 'numeric', month: 'short' });
};

// text: indexes of the columns aligned to the left (the others hold numbers).
function table(headers, rows, { text = [0], foot = null } = {}) {
  const cell = (tag, value, i) => h(tag, { class: text.includes(i) ? 'text' : '' }, value);
  return h('div', { class: 'tablewrap' },
    h('table', {},
      h('thead', {}, h('tr', {}, headers.map((x, i) => cell('th', x, i)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => cell('td', c, i))))),
      foot ? h('tfoot', {}, h('tr', {}, foot.map((c, i) => cell('td', c, i)))) : null));
}

const csvUrl = (kind) => `/api/stats/export.csv?${new URLSearchParams({ kind, ...range })}`;
const empty = () => h('p', { class: 'muted' }, t('stats.empty'));

const section = (title, kind, body, extra = null) =>
  h('section', {},
    h('h2', {}, title, h('a', { class: 'export', href: csvUrl(kind) }, t('stats.export'))),
    body,
    extra);

async function load() {
  const qs = new URLSearchParams(range).toString();
  const [revenue, products, modifiers] = await Promise.all([
    api('GET', `/api/stats/revenue?${qs}`),
    api('GET', `/api/stats/products?${qs}`),
    api('GET', `/api/stats/modifiers?${qs}`),
  ]);
  const col = (key) => t(`stats.col.${key}`);
  const totals = revenue.totals;

  results.replaceChildren(...[
    section(t('stats.section.revenue'), 'revenue',
      revenue.rows.length
        ? table(
          [col('period'), col('orders'), col('subtotal'), col('adjustment'), col('paid')],
          revenue.rows.map((r) => [
            periodLabel(r.period, revenue.group), String(r.orders), money(r.subtotal_cents), money(r.adjustment_cents), money(r.paid_cents),
          ]),
          { foot: [t('stats.total'), String(totals.orders), money(totals.subtotal_cents), money(totals.adjustment_cents), money(totals.paid_cents)] })
        : empty(),
      h('p', {}, h('a', { class: 'export', href: csvUrl('orders') }, t('stats.export.orders')))),

    section(t('stats.section.products'), 'products',
      products.items.length
        ? table(
          [col('name'), col('category'), col('quantity'), col('revenue')],
          products.items.map((x) => [x.name, x.category, String(x.quantity), money(x.revenue_cents)]),
          { text: [0, 1] })
        : empty()),

    products.custom.length
      ? section(t('stats.section.custom'), 'custom',
        table(
          [col('name'), col('quantity'), col('revenue')],
          products.custom.map((x) => [x.name, String(x.quantity), money(x.revenue_cents)])))
      : null,

    section(t('stats.section.modifiers'), 'modifiers',
      modifiers.modifiers.length
        ? table(
          [col('name'), col('quantity'), col('extra'), col('items')],
          modifiers.modifiers.map((x) => [
            x.name, String(x.quantity), money(x.revenue_cents), x.items.map((i) => `${i.name} ×${i.quantity}`).join(', '),
          ]),
          { text: [0, 3] })
        : empty()),

    h('p', { class: 'hint' }, t('stats.note.listPrice')),
  ].filter(Boolean));
}

const run = () => load().catch(() => results.replaceChildren(h('p', {}, t('common.error'))));

function buildPage() {
  const from = h('input', { type: 'date', value: range.from });
  const to = h('input', { type: 'date', value: range.to });
  const group = h('select', {}, ['day', 'week', 'month'].map((g) => h('option', { value: g }, t(`stats.group.${g}`))));
  group.value = range.group;
  const sync = () => {
    from.value = range.from;
    to.value = range.to;
    group.value = range.group;
  };

  app.replaceChildren(
    h('div', { class: 'controls' },
      h('div', { class: 'presets' }, Object.keys(presets).map((id) =>
        h('button', { type: 'button', onclick: () => { range = presets[id](); sync(); run(); } }, t(`stats.preset.${id}`)))),
      h('form', {
        class: 'range',
        onsubmit: (e) => {
          e.preventDefault();
          if (!from.value || !to.value) return;
          range = { from: from.value, to: to.value, group: group.value };
          run();
        },
      },
      h('label', {}, `${t('stats.range.from')} `, from),
      h('label', {}, `${t('stats.range.to')} `, to),
      group,
      h('button', { type: 'submit' }, t('stats.apply')))),
    results);
  return run();
}

try {
  language = (await loadI18n()).language;
  currency = (await api('GET', '/api/config')).currency;
  await requirePin(app);
  await buildPage();
} catch {
  app.textContent = t('common.error');
}
