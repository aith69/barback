import { loadI18n, t } from '/shared/i18n.js';
import { api } from '/shared/api.js';
import { h } from '/shared/dom.js';
import { currencySymbol, formatDecimal, formatMoney, parseMoney } from '/shared/money.js';
import { onLive } from '/shared/live.js';

const app = document.getElementById('app');
let language = 'en';
let currency = 'EUR';
let operators = [];
let operator = null;
let menu = { categories: [] };
let timer = null; // polling interval of the current view
let unsent = () => 0; // set by the table page: how many lines are waiting to be sent

const money = (cents) => formatMoney(cents, language, currency);
const fill = (el, ...children) => el.replaceChildren(...children.flat().filter(Boolean));
const findItem = (id) => menu.categories.flatMap((c) => c.items).find((i) => i.id === id);
// Price per unit of a line not sent yet: item + quick notes + free-text note.
const draftUnit = (d) =>
  d.item.price_cents +
  d.item.modifiers.filter((m) => d.modifier_ids.includes(m.id)).reduce((sum, m) => sum + (m.price_cents ?? 0), 0) +
  (d.note ? (d.note_price_cents ?? 0) : 0);
const noteNames = (item, ids) => item.modifiers.filter((m) => ids.includes(m.id)).map((m) => m.name).join(', ');
const mustChoose = (item) => item.modifiers.some((m) => m.required);

const savedOperator = {
  get() { try { return Number(localStorage.getItem('barback.operator')) || null; } catch { return null; } },
  set(id) { try { localStorage.setItem('barback.operator', String(id)); } catch { /* private mode */ } },
};

function leaveOk() {
  if (unsent() === 0) return true;
  if (!confirm(t('waiter.confirmLeave'))) return false;
  unsent = () => 0; // discarded: no second prompt from the browser
  return true;
}
window.barbackCanLeave = leaveOk; // asked by the Home link

const topbar = (...left) =>
  h('div', { class: 'topbar' }, h('div', {}, ...left),
    h('button', { type: 'button', class: 'link', onclick: () => { if (leaveOk()) { operator = null; route(); } } }, `${operator.name} · ${t('who.change')}`));

// --- "Who are you?" ---
function showWho() {
  fill(app, h('h2', {}, t('who.title')),
    operators.length
      ? h('div', { class: 'who' }, operators.map((o) =>
        h('button', { type: 'button', onclick: () => { operator = o; savedOperator.set(o.id); route(); } }, o.name)))
      : h('p', {}, t('who.empty')));
}

const setServed = (number, served) =>
  api('POST', `/api/tables/${number}/served`, { served }).catch(() => alert(t('common.error')));

// Tables whose lines are all prepared and not served yet.
function readyList(tables, onChange) {
  const ready = tables.filter((tb) => tb.occupied && tb.pending === 0 && tb.to_serve > 0);
  if (!ready.length) return null;
  return h('div', { class: 'ready-list' },
    h('h3', {}, t('waiter.ready')),
    ready.map((tb) => h('div', { class: 'ready-row' },
      h('a', { href: `#/table/${tb.number}` }, t('table.title', { number: tb.number })),
      h('button', { type: 'button', class: 'primary', onclick: () => setServed(tb.number, true).then(onChange) }, t('waiter.served')))));
}

// The table list with a separator entry between the inside tables and the outside ones.
function withSeparator(tables) {
  const out = [];
  tables.forEach((tb, i) => {
    if (i > 0 && tb.area !== tables[i - 1].area) out.push({ separator: true });
    out.push(tb);
  });
  return out;
}

// --- table grid ---
async function showGrid() {
  const me = (timer = onLive(() => draw().catch(() => {})));
  const draw = async () => {
    const tables = await api('GET', '/api/tables');
    if (timer !== me) return; // navigated away meanwhile
    fill(app, topbar(h('h2', {}, t('waiter.tables'))),
      h('div', { class: 'grid' }, withSeparator(tables).map((tb) => tb.separator ? h('hr', { class: 'sep' }) :
        h('a', { href: `#/table/${tb.number}`, class: tb.occupied ? 'table on' : 'table' },
          h('strong', {}, String(tb.number)),
          h('small', {}, tb.pending ? `⏳ ${tb.pending}` : tb.to_serve ? '✓' : '')))),
      readyList(tables, () => draw().catch(() => {})));
  };
  try { await draw(); } catch { fill(app, h('p', {}, t('common.error'))); }
}

// --- line editor (quantity, quick notes, free text) ---
function openEditor({ title, item, quantity = 1, selected = [], note = '', notePrice = 0, extraNotes = [], askName = false, onSave, onRemove }) {
  // askName: a custom item, the text field is its name.
  // Otherwise the text field is a free-text note, with an optional extra price.
  let qty = quantity;
  const chosen = new Set(selected);
  const available = [...item.modifiers, ...extraNotes.filter((m) => !item.modifiers.some((x) => x.id === m.id))];
  const qtyEl = h('strong', {}, String(qty));
  const textInput = h('input', {
    type: 'text',
    maxlength: askName ? 80 : 200,
    value: note,
    placeholder: t(askName ? 'waiter.customPlaceholder' : 'waiter.notePlaceholder'),
  });
  const priceInput = askName ? null : h('input', {
    type: 'text',
    inputmode: 'decimal',
    class: 'extra',
    value: notePrice ? formatDecimal(notePrice, language) : '',
    placeholder: `${t('waiter.notePrice')} (${currencySymbol(language, currency)})`,
  });
  // Required notes: at least one of them has to be chosen to save (more than one is fine).
  const mustPick = item.modifiers.filter((m) => m.required);
  const hint = mustPick.length ? h('p', { class: 'reqhint' }, t('waiter.requiredHint')) : null;
  const dlg = h('dialog', { class: 'editor' });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.append(...[
    h('h3', {}, title),
    h('div', { class: 'qty' },
      h('button', { type: 'button', onclick: () => { if (qty > 1) qtyEl.textContent = String(--qty); } }, '−'),
      qtyEl,
      h('button', { type: 'button', onclick: () => { if (qty < 99) qtyEl.textContent = String(++qty); } }, '+')),
    hint,
    available.length
      ? h('div', { class: 'mods' }, available.map((m) =>
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: chosen.has(m.id), onchange: (e) => (e.target.checked ? chosen.add(m.id) : chosen.delete(m.id)) }),
          `${m.name}${m.required ? ' *' : ''}${m.price_cents ? ` (+${money(m.price_cents)})` : ''}`)))
      : null,
    textInput,
    priceInput,
    h('div', { class: 'actions' },
      onRemove ? h('button', { type: 'button', class: 'danger', onclick: () => { dlg.close(); onRemove(); } }, t('common.delete')) : null,
      h('button', { type: 'button', onclick: () => dlg.close() }, t('common.cancel')),
      h('button', { type: 'button', class: 'primary', onclick: () => {
        const text = textInput.value.trim();
        if (askName && !text) { textInput.focus(); return; }
        if (mustPick.length && !mustPick.some((m) => chosen.has(m.id))) { hint.classList.add('bad'); return; }
        let extra = 0;
        if (priceInput && text && priceInput.value.trim() !== '') {
          extra = parseMoney(priceInput.value);
          if (extra === null) { alert(t('admin.error.price')); return; }
        }
        dlg.close();
        onSave({ quantity: qty, modifier_ids: [...chosen], note: text, note_price_cents: extra, name: text });
      } }, t('common.save'))),
  ].filter(Boolean));
  document.body.append(dlg);
  dlg.showModal();
}

// --- table page ---
async function showTable(number, fromCash = false) {
  const me = (timer = onLive(() => load().catch(() => {})));
  let order = null;
  let categoryId = null;
  let sending = false;
  const draft = []; // lines not sent yet, only on this phone
  unsent = () => draft.length;
  const existing = h('div');
  const drafts = h('div');
  const picker = h('div');

  fill(app,
    topbar(h('a', {
      href: fromCash ? `/counter/#/cash/${number}` : '#/',
      onclick: (e) => { if (fromCash && !leaveOk()) e.preventDefault(); },
    }, `← ${t('common.back')}`), h('h2', {}, t('table.title', { number }))),
    existing, picker, drafts);

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
      notePrice: l.note_price_cents ?? 0,
      extraNotes: l.modifiers,
      onSave: (v) => mutate(() => api('PATCH', `/api/lines/${l.id}`, { operator_id: operator.id, ...v })),
      onRemove: () => {
        if (confirm(t('waiter.confirmRemove'))) mutate(() => api('DELETE', `/api/lines/${l.id}?operator_id=${operator.id}`));
      },
    });
  }

  function serveButton(lines) {
    const toServe = lines.some((l) => l.status === 'prepared' && !l.served_at);
    const served = lines.some((l) => l.served_at);
    if (!toServe && !served) return null;
    return h('button', {
      type: 'button',
      class: toServe ? 'primary send' : 'link',
      onclick: () => setServed(number, toServe).then(() => load().catch(() => {})),
    }, t(toServe ? 'waiter.served' : 'waiter.unserve'));
  }

  function drawExisting() {
    const lines = order ? order.lines : [];
    fill(existing,
      h('h3', {}, t('waiter.existing')),
      lines.length
        ? h('ul', { class: 'lines' }, lines.map((l) =>
          h('li', { class: `line ${l.served_at ? 'served' : l.status}`, onclick: () => editExisting(l) },
            h('span', { class: 'body' },
              `${l.quantity}× ${l.item_name}`,
              l.modifiers.length ? h('small', {}, l.modifiers.map((m) => m.name).join(', ')) : null,
              l.note ? h('small', {}, `“${l.note}”`) : null),
            h('span', { class: 'side' }, l.price_pending ? t('waiter.priceTbd') : money(l.quantity * l.unit_price_cents),
              h('span', { class: 'status' }, t(`line.status.${l.served_at ? 'served' : l.status}`))))))
        : h('p', { class: 'muted' }, t('waiter.empty')),
      order && lines.length ? h('p', { class: 'total' }, `${t('table.total')}: ${money(order.subtotal_cents)}${order.unpriced ? ' + ?' : ''}`) : null,
      serveButton(lines));
  }

  function addToDraft(item) {
    if (mustChoose(item)) { // required notes: ask first, nothing is added if the editor is cancelled
      openEditor({
        title: item.name,
        item,
        onSave: (v) => {
          draft.push({ item, quantity: v.quantity, modifier_ids: v.modifier_ids, note: v.note, note_price_cents: v.note_price_cents });
          drawDraft();
        },
      });
      return;
    }
    const same = draft.find((d) => d.item.id === item.id && !d.note && !d.modifier_ids.length);
    if (same) same.quantity += 1;
    else draft.push({ item, quantity: 1, modifier_ids: [], note: '' });
    drawDraft();
  }

  function editDraft(index) {
    const d = draft[index];
    const remove = () => { draft.splice(index, 1); drawDraft(); };
    if (d.item.custom) {
      openEditor({
        title: t('waiter.custom'),
        item: d.item,
        quantity: d.quantity,
        note: d.item.name,
        askName: true,
        onSave: (v) => { d.quantity = v.quantity; d.item.name = v.name; drawDraft(); },
        onRemove: remove,
      });
      return;
    }
    openEditor({
      title: d.item.name,
      item: d.item,
      quantity: d.quantity,
      selected: d.modifier_ids,
      note: d.note,
      notePrice: d.note_price_cents ?? 0,
      onSave: (v) => {
        Object.assign(d, { quantity: v.quantity, modifier_ids: v.modifier_ids, note: v.note, note_price_cents: v.note_price_cents });
        drawDraft();
      },
      onRemove: remove,
    });
  }

  async function send() {
    if (sending) return;
    sending = true;
    const lines = draft.map((d) => (d.item.custom
      ? { custom_name: d.item.name, quantity: d.quantity }
      : {
        item_id: d.item.id,
        quantity: d.quantity,
        note: d.note || undefined,
        note_price_cents: d.note ? (d.note_price_cents ?? 0) : 0,
        modifier_ids: d.modifier_ids,
      }));
    try {
      order = (await api('POST', `/api/tables/${number}/lines`, { operator_id: operator.id, lines })).order;
      draft.length = 0;
      if (fromCash) { location.href = `/counter/#/cash/${number}`; return; } // back to the cash register
      location.hash = '#/'; // back to the table list
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
            h('span', { class: 'side' }, d.item.custom ? '?' : money(d.quantity * draftUnit(d)))))),
        h('button', { type: 'button', class: 'primary send', onclick: send },
          `${t('waiter.send')} (${draft.reduce((n, d) => n + d.quantity, 0)})`))
      : null);
  }

  // Text-only item: the price is decided later, at the counter or at the cash register.
  function addCustom() {
    openEditor({
      title: t('waiter.custom'),
      item: { modifiers: [] },
      askName: true,
      onSave: (v) => {
        draft.push({
          item: { id: null, custom: true, name: v.name, price_cents: 0, modifiers: [] },
          quantity: v.quantity,
          modifier_ids: [],
          note: '',
          note_price_cents: 0,
        });
        drawDraft();
      },
    });
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
          h('small', {}, i.sold_out ? t('item.soldOut') : money(i.price_cents)))),
        h('button', { type: 'button', class: 'item custom', onclick: addCustom }, h('span', {}, `+ ${t('waiter.custom')}`))));
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
let shownHash = location.hash; // address of the page on screen
let restoring = false;

// Back/forward and links between pages: ask before dropping unsent lines.
function onHashChange() {
  if (restoring) { restoring = false; return; } // we just put the old address back
  if (unsent() > 0 && !confirm(t('waiter.confirmLeave'))) {
    restoring = true;
    location.hash = shownHash; // stay: nothing is re-rendered, the lines are still there
    return;
  }
  shownHash = location.hash;
  route();
}
function route() {
  if (timer) timer(); // stops the live updates of the previous view
  unsent = () => 0;
  timer = null;
  if (!operator) return showWho();
  const match = location.hash.match(/^#\/table\/(\d+)(\/cash)?$/);
  return match ? showTable(Number(match[1]), Boolean(match[2])) : showGrid();
}

try {
  const i18n = await loadI18n();
  language = i18n.language;
  const [config, ops, menuData] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/operators'), api('GET', '/api/menu')]);
  currency = config.currency;
  operators = ops;
  menu = menuData;
  operator = operators.find((o) => o.id === savedOperator.get()) ?? null;
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('beforeunload', (e) => {
    if (unsent() > 0) { e.preventDefault(); e.returnValue = ''; }
  });
  route();
} catch {
  app.textContent = t('common.error');
}
