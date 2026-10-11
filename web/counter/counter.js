import { loadI18n, t } from '/shared/i18n.js';
import { api } from '/shared/api.js';
import { h } from '/shared/dom.js';
import { onLive } from '/shared/live.js';
import { currencySymbol, formatDecimal, formatMoney, parseMoney } from '/shared/money.js';

const app = document.getElementById('app');
let language = 'en';
let currency = 'EUR';
let symbol = '€';
let operators = [];
let operator = null;
let stop = null; // stops the live updates of the current view

const money = (cents) => formatMoney(cents, language, currency);
const fill = (el, ...children) => el.replaceChildren(...children.flat().filter(Boolean));
const clock = (iso) => new Date(iso).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
const notesOf = (line) =>
  [...line.modifiers.map((m) => m.name), line.note ? `“${line.note}”` : null].filter(Boolean).join(' · ');

const savedOperator = {
  get() { try { return Number(localStorage.getItem('barback.operator')) || null; } catch { return null; } },
  set(id) { try { localStorage.setItem('barback.operator', String(id)); } catch { /* private mode */ } },
};

const header = (active) =>
  h('div', {},
    h('div', { class: 'topbar' },
      h('h2', {}, t('role.counter')),
      h('button', { type: 'button', class: 'link', onclick: () => { operator = null; route(); } }, `${operator.name} · ${t('who.change')}`)),
    h('nav', { class: 'tabs' }, ['queue', 'cash'].map((id) =>
      h('a', { href: id === 'queue' ? '#/' : '#/cash', class: id === active ? 'on' : '' }, t(`counter.tab.${id}`)))));

function showWho() {
  fill(app, h('h2', {}, t('who.title')),
    operators.length
      ? h('div', { class: 'who' }, operators.map((o) =>
        h('button', { type: 'button', onclick: () => { operator = o; savedOperator.set(o.id); route(); } }, o.name)))
      : h('p', {}, t('who.empty')));
}

// --- preparation queue ---
const setLine = (id, status) => api('PUT', `/api/counter/lines/${id}/status`, { status });
const setTable = (number, prepared) => api('POST', `/api/counter/tables/${number}/prepared`, { prepared });
const firstTodo = (tb) => tb.lines.find((l) => l.status === 'new');

async function showQueue() {
  const me = (stop = onLive(() => draw().catch(() => {})));
  const act = (fn) => fn().catch(() => alert(t('common.error'))).then(() => draw().catch(() => {}));

  const card = (tb) => {
    const todo = tb.lines.filter((l) => l.status === 'new');
    const done = tb.lines.filter((l) => l.status === 'prepared');
    return h('section', { class: 'card' },
      h('header', {},
        h('h3', {}, t('table.title', { number: tb.table })),
        h('small', {}, clock(todo[0].created_at)),
        h('button', { type: 'button', class: 'primary', onclick: () => act(() => setTable(tb.table, true)) }, t('counter.allDone'))),
      todo.map((l) => h('button', { type: 'button', class: 'todo', onclick: () => act(() => setLine(l.id, 'prepared')) },
        h('span', {}, `${l.quantity}× ${l.item_name}`), h('small', {}, notesOf(l)))),
      done.map((l) => h('button', { type: 'button', class: 'todo done', onclick: () => act(() => setLine(l.id, 'new')) },
        h('span', {}, `✓ ${l.quantity}× ${l.item_name}`), h('small', {}, notesOf(l)))));
  };

  const draw = async () => {
    const tables = await api('GET', '/api/counter/queue');
    if (stop !== me) return; // navigated away meanwhile
    const todo = tables
      .filter((tb) => firstTodo(tb))
      .sort((a, b) => firstTodo(a).created_at.localeCompare(firstTodo(b).created_at));
    const ready = tables.filter((tb) => tb.lines.every((l) => l.status === 'prepared'));
    fill(app, header('queue'),
      todo.length ? todo.map(card) : h('p', { class: 'muted' }, t('counter.queue.empty')),
      ready.length
        ? h('div', {},
          h('h3', {}, t('counter.ready')),
          ready.map((tb) => h('div', { class: 'ready' },
            h('strong', {}, t('table.title', { number: tb.table })),
            h('button', { type: 'button', onclick: () => act(() => setTable(tb.table, false)) }, t('counter.undo')))))
        : null);
  };

  try { await draw(); } catch { fill(app, h('p', {}, t('common.error'))); }
}

// --- cash: open tables ---
async function showCash() {
  const me = (stop = onLive(() => draw().catch(() => {})));
  const draw = async () => {
    const tables = await api('GET', '/api/counter/tables');
    if (stop !== me) return;
    fill(app, header('cash'),
      tables.length
        ? h('div', { class: 'cash' }, tables.map((tb) =>
          h('a', { href: `#/cash/${tb.number}`, class: 'cashrow' },
            h('strong', {}, t('table.title', { number: tb.number })),
            h('span', {}, tb.pending ? `⏳ ${tb.pending}` : tb.lines ? '✓' : ''),
            h('span', {}, money(tb.subtotal_cents)))))
        : h('p', { class: 'muted' }, t('counter.cash.empty')));
  };
  try { await draw(); } catch { fill(app, h('p', {}, t('common.error'))); }
}

// --- cash: one table ---
async function showCashTable(number) {
  const me = (stop = onLive(() => load().catch(() => {})));
  let order = null;
  let touched = false; // the amount paid was edited by hand: do not overwrite it on refresh
  const subtotal = () => (order ? order.subtotal_cents : 0);
  const linesBox = h('div');
  const totalEl = h('p', { class: 'total' });
  const adjustEl = h('p', { class: 'adjust' });
  const input = h('input', { type: 'text', inputmode: 'decimal', oninput: () => { touched = true; syncAdjustment(); } });

  function syncAdjustment() {
    const cents = parseMoney(input.value);
    adjustEl.textContent = cents === null ? '' : `${t('counter.cash.adjustment')}: ${money(cents - subtotal())}`;
  }

  function drawLines() {
    fill(linesBox, order.lines.length
      ? h('ul', { class: 'lines' }, order.lines.map((l) =>
        h('li', { class: `line ${l.status}` },
          h('span', { class: 'body' }, `${l.quantity}× ${l.item_name}`, notesOf(l) ? h('small', {}, notesOf(l)) : null),
          h('span', { class: 'side' }, money(l.quantity * l.unit_price_cents),
            h('button', { type: 'button', class: 'link', title: t('common.delete'), onclick: () => removeLine(l) }, '✕')))))
      : h('p', { class: 'muted' }, t('waiter.empty')));
  }

  async function load() {
    const res = await api('GET', `/api/tables/${number}`);
    if (stop !== me) return;
    if (!res.order) { location.hash = '#/cash'; return; } // closed from another device
    order = res.order;
    drawLines();
    totalEl.textContent = `${t('table.total')}: ${money(subtotal())}`;
    if (!touched) input.value = formatDecimal(subtotal(), language);
    syncAdjustment();
  }

  async function removeLine(l) {
    if (!confirm(t('waiter.confirmRemove'))) return;
    try { await api('DELETE', `/api/lines/${l.id}?operator_id=${operator.id}`); } catch { alert(t('common.error')); }
    await load().catch(() => {});
  }

  async function close() {
    const cents = parseMoney(input.value);
    if (cents === null) { alert(t('counter.error.amount')); return; }
    if (!confirm(t('counter.cash.confirmClose', { number, amount: money(cents) }))) return;
    try {
      await api('POST', `/api/counter/tables/${number}/close`, { operator_id: operator.id, total_paid_cents: cents });
      location.hash = '#/cash';
    } catch {
      alert(t('common.error'));
    }
  }

  fill(app,
    h('div', { class: 'topbar' }, h('a', { href: '#/cash' }, `← ${t('common.back')}`), h('h2', {}, t('table.title', { number }))),
    linesBox,
    h('p', {}, h('a', { href: `/waiter/#/table/${number}` }, t('counter.cash.addItems'))),
    totalEl,
    h('label', { class: 'pay' }, t('counter.cash.paid'), input, symbol),
    adjustEl,
    h('div', { class: 'actions' },
      h('button', { type: 'button', onclick: () => {
        touched = true;
        input.value = formatDecimal(Math.floor(subtotal() / 100) * 100, language);
        syncAdjustment();
      } }, t('counter.cash.roundDown')),
      h('button', { type: 'button', class: 'primary', onclick: close }, t('counter.cash.close'))));

  try { await load(); } catch { fill(app, h('p', {}, t('common.error'))); }
}

// --- routing ---
function route() {
  if (stop) stop();
  stop = null;
  if (!operator) return showWho();
  const match = location.hash.match(/^#\/cash\/(\d+)$/);
  if (match) return showCashTable(Number(match[1]));
  return location.hash === '#/cash' ? showCash() : showQueue();
}

try {
  language = (await loadI18n()).language;
  const [config, ops] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/operators')]);
  currency = config.currency;
  symbol = currencySymbol(language, currency);
  operators = ops;
  operator = operators.find((o) => o.id === savedOperator.get()) ?? null;
  window.addEventListener('hashchange', route);
  route();
} catch {
  app.textContent = t('common.error');
}
