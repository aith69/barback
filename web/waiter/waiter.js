import { loadI18n, t } from '/shared/i18n.js';
import { api } from '/shared/api.js';
import { h } from '/shared/dom.js';
import { formatMoney } from '/shared/money.js';

const app = document.getElementById('app');
let language = 'en';
let currency = 'EUR';
let operators = [];
let operator = null;
let menu = { categories: [] };
let timer = null; // polling interval of the current view

const money = (cents) => formatMoney(cents, language, currency);
const fill = (el, ...children) => el.replaceChildren(...children.flat().filter(Boolean));
const findItem = (id) => menu.categories.flatMap((c) => c.items).find((i) => i.id === id);
const noteNames = (item, ids) => item.modifiers.filter((m) => ids.includes(m.id)).map((m) => m.name).join(', ');

const savedOperator = {
  get() { try { return Number(localStorage.getItem('barback.operator')) || null; } catch { return null; } },
  set(id) { try { localStorage.setItem('barback.operator', String(id)); } catch { /* private mode */ } },
};

const topbar = (...left) =>
  h('div', { class: 'topbar' }, h('div', {}, ...left),
    h('button', { type: 'button', class: 'link', onclick: () => { operator = null; route(); } }, `${operator.name} · ${t('who.change')}`));

// --- "Who are you?" ---
function showWho() {
  fill(app, h('h2', {}, t('who.title')),
    operators.length
      ? h('div', { class: 'who' }, operators.map((o) =>
        h('button', { type: 'button', onclick: () => { operator = o; savedOperator.set(o.id); route(); } }, o.name)))
      : h('p', {}, t('who.empty')));
}

// --- table grid ---
async function showGrid() {
  const me = (timer = setInterval(() => draw().catch(() => {}), 5000));
  const draw = async () => {
    const tables = await api('GET', '/api/tables');
    if (timer !== me) return; // navigated away meanwhile
    fill(app, topbar(h('h2', {}, t('waiter.tables'))),
      h('div', { class: 'grid' }, tables.map((tb) =>
        h('a', { href: `#/table/${tb.number}`, class: tb.occupied ? 'table on' : 'table' },
          h('strong', {}, String(tb.number)),
          h('small', {}, tb.pending ? `⏳ ${tb.pending}` : tb.prepared ? '✓' : '')))));
  };
  try { await draw(); } catch { fill(app, h('p', {}, t('common.error'))); }
}

// --- line editor (quantity, quick notes, free text) ---
function openEditor({ title, item, quantity = 1, selected = [], note = '', extraNotes = [], onSave, onRemove }) {
  let qty = quantity;
  const chosen = new Set(selected);
  const available = [...item.modifiers, ...extraNotes.filter((m) => !item.modifiers.some((x) => x.id === m.id))];
  const qtyEl = h('strong', {}, String(qty));
  const noteInput = h('input', { type: 'text', maxlength: 200, value: note, placeholder: t('waiter.notePlaceholder') });
  const dlg = h('dialog', { class: 'editor' });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.append(...[
    h('h3', {}, title),
    h('div', { class: 'qty' },
      h('button', { type: 'button', onclick: () => { if (qty > 1) qtyEl.textContent = String(--qty); } }, '−'),
      qtyEl,
      h('button', { type: 'button', onclick: () => { if (qty < 99) qtyEl.textContent = String(++qty); } }, '+')),
    available.length
      ? h('div', { class: 'mods' }, available.map((m) =>
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: chosen.has(m.id), onchange: (e) => (e.target.checked ? chosen.add(m.id) : chosen.delete(m.id)) }),
          m.name)))
      : null,
    noteInput,
    h('div', { class: 'actions' },
      onRemove ? h('button', { type: 'button', class: 'danger', onclick: () => { dlg.close(); onRemove(); } }, t('common.delete')) : null,
      h('button', { type: 'button', onclick: () => dlg.close() }, t('common.cancel')),
      h('button', { type: 'button', class: 'primary', onclick: () => {
        dlg.close();
        onSave({ quantity: qty, modifier_ids: [...chosen], note: noteInput.value.trim() });
      } }, t('common.save'))),
  ].filter(Boolean));
  document.body.append(dlg);
  dlg.showModal();
}

// --- table page ---
async function showTable(number) {
  const me = (timer = setInterval(() => load().catch(() => {}), 5000));
  let order = null;
  let categoryId = null;
  let sending = false;
  const draft = []; // lines not sent yet, only on this phone
  const existing = h('div');
  const drafts = h('div');
  const picker = h('div');

  fill(app,
    topbar(h('a', { href: '#/' }, `← ${t('common.back')}`), h('h2', {}, t('table.title', { number }))),
    existing, drafts, picker);

  async function load() {
    const res = await api('GET', `/api/tables/${number}`);
    if (timer !== me) return;
    order = res.order;
    drawExisting();
  }

  async function mutate(fn) {
    try {
      order = (await fn()).order;
    } catch {
      alert(t('common.error'));
      await load();
      return;
    }
    drawExisting();
  }

  function editExisting(l) {
    openEditor({
      title: l.item_name,
      item: findItem(l.item_id) ?? { modifiers: [] },
      quantity: l.quantity,
      selected: l.modifiers.map((m) => m.id),
      note: l.note ?? '',
      extraNotes: l.modifiers,
      onSave: (v) => mutate(() => api('PATCH', `/api/lines/${l.id}`, { operator_id: operator.id, ...v })),
      onRemove: () => {
        if (confirm(t('waiter.confirmRemove'))) mutate(() => api('DELETE', `/api/lines/${l.id}?operator_id=${operator.id}`));
      },
    });
  }

  function drawExisting() {
    const lines = order ? order.lines : [];
    fill(existing,
      h('h3', {}, t('waiter.existing')),
      lines.length
        ? h('ul', { class: 'lines' }, lines.map((l) =>
          h('li', { class: `line ${l.status}`, onclick: () => editExisting(l) },
            h('span', { class: 'body' },
              `${l.quantity}× ${l.item_name}`,
              l.modifiers.length ? h('small', {}, l.modifiers.map((m) => m.name).join(', ')) : null,
              l.note ? h('small', {}, `“${l.note}”`) : null),
            h('span', { class: 'side' }, money(l.quantity * l.unit_price_cents),
              h('span', { class: 'status' }, t(`line.status.${l.status}`))))))
        : h('p', { class: 'muted' }, t('waiter.empty')),
      order && lines.length ? h('p', { class: 'total' }, `${t('table.total')}: ${money(order.subtotal_cents)}`) : null);
  }

  function addToDraft(item) {
    const same = draft.find((d) => d.item.id === item.id && !d.note && !d.modifier_ids.length);
    if (same) same.quantity += 1;
    else draft.push({ item, quantity: 1, modifier_ids: [], note: '' });
    drawDraft();
  }

  function editDraft(index) {
    const d = draft[index];
    openEditor({
      title: d.item.name,
      item: d.item,
      quantity: d.quantity,
      selected: d.modifier_ids,
      note: d.note,
      onSave: (v) => { Object.assign(d, v); drawDraft(); },
      onRemove: () => { draft.splice(index, 1); drawDraft(); },
    });
  }

  async function send() {
    if (sending) return;
    sending = true;
    const lines = draft.map((d) => ({
      item_id: d.item.id,
      quantity: d.quantity,
      note: d.note || undefined,
      modifier_ids: d.modifier_ids,
    }));
    try {
      order = (await api('POST', `/api/tables/${number}/lines`, { operator_id: operator.id, lines })).order;
      draft.length = 0;
      drawDraft();
      drawExisting();
    } catch (e) {
      alert(e.status === 400 || e.status === 409 ? t('waiter.error.unavailable') : t('common.error'));
      try { menu = await api('GET', '/api/menu'); drawPicker(); } catch { /* keep the old menu */ }
    } finally {
      sending = false;
    }
  }

  function drawDraft() {
    fill(drafts, draft.length
      ? h('div', {},
        h('h3', {}, t('waiter.draft')),
        h('ul', { class: 'lines' }, draft.map((d, i) =>
          h('li', { class: 'line', onclick: () => editDraft(i) },
            h('span', { class: 'body' },
              `${d.quantity}× ${d.item.name}`,
              d.modifier_ids.length ? h('small', {}, noteNames(d.item, d.modifier_ids)) : null,
              d.note ? h('small', {}, `“${d.note}”`) : null),
            h('span', { class: 'side' }, money(d.quantity * d.item.price_cents))))),
        h('button', { type: 'button', class: 'primary send', onclick: send },
          `${t('waiter.send')} (${draft.reduce((n, d) => n + d.quantity, 0)})`))
      : null);
  }

  function drawPicker() {
    if (!menu.categories.length) { fill(picker, h('p', { class: 'muted' }, t('waiter.noMenu'))); return; }
    const category = menu.categories.find((c) => c.id === categoryId) ?? menu.categories[0];
    fill(picker,
      h('div', { class: 'cats' }, menu.categories.map((c) =>
        h('button', { type: 'button', class: c === category ? 'on' : '', onclick: () => { categoryId = c.id; drawPicker(); } }, c.name))),
      h('div', { class: 'items' }, category.items.map((i) =>
        h('button', { type: 'button', class: 'item', disabled: i.sold_out, onclick: () => addToDraft(i) },
          h('span', {}, i.name),
          h('small', {}, i.sold_out ? t('item.soldOut') : money(i.price_cents))))));
  }

  try {
    menu = await api('GET', '/api/menu'); // fresh: sold-out flags may have changed
    if (timer !== me) return;
    categoryId = menu.categories[0]?.id ?? null;
    drawPicker();
    drawDraft();
    await load();
  } catch {
    fill(app, h('p', {}, t('common.error')));
  }
}

// --- routing ---
function route() {
  clearInterval(timer);
  timer = null;
  if (!operator) return showWho();
  const match = location.hash.match(/^#\/table\/(\d+)$/);
  return match ? showTable(Number(match[1])) : showGrid();
}

try {
  const i18n = await loadI18n();
  language = i18n.language;
  const [config, ops, menuData] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/operators'), api('GET', '/api/menu')]);
  currency = config.currency;
  operators = ops;
  menu = menuData;
  operator = operators.find((o) => o.id === savedOperator.get()) ?? null;
  window.addEventListener('hashchange', route);
  route();
} catch {
  app.textContent = t('common.error');
}
