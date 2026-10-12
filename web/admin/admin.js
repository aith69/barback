import { loadI18n, t } from '/shared/i18n.js';
import { api } from '/shared/api.js';
import { h } from '/shared/dom.js';
import { requirePin } from '/shared/pin.js';
import { currencySymbol, formatDecimal, parseMoney } from '/shared/money.js';

const app = document.getElementById('app');
const state = { tab: 'menu', operators: [], categories: [], items: [], modifiers: [] };
let language = 'en';
let symbol = '€';

async function refresh() {
  const [menu, operators] = await Promise.all([api('GET', '/api/admin/menu'), api('GET', '/api/admin/operators')]);
  Object.assign(state, menu, { operators });
  render();
}

// Runs a change, reports errors, then reloads from the server.
async function act(fn) {
  try {
    await fn();
  } catch (e) {
    alert(e.status === 409 ? t('admin.error.exists') : t('common.error'));
  }
  await refresh();
}

const remove = (resource, id, name, message = 'admin.confirmDelete') => {
  if (confirm(t(message, { name }))) act(() => api('DELETE', `/api/admin/${resource}/${id}`));
};

const patch = (resource, id, body) => act(() => api('PATCH', `/api/admin/${resource}/${id}`, body));

// --- building blocks ---
function nameInput(value, onSave) {
  return h('input', {
    type: 'text', value, maxlength: 80, size: Math.max(6, value.length),
    onchange: (e) => (e.target.value.trim() ? onSave(e.target.value.trim()) : refresh()),
  });
}

const check = (label, checked, onToggle) =>
  h('label', { class: 'check' }, h('input', { type: 'checkbox', checked, onchange: (e) => onToggle(e.target.checked) }), label);

function addForm(placeholder, onAdd, withPrice = false) {
  const name = h('input', { type: 'text', placeholder, maxlength: 80, required: true });
  const price = withPrice
    ? h('input', { type: 'text', inputmode: 'decimal', placeholder: `${t('admin.item.price')} (${symbol})`, size: 8, required: true })
    : null;
  return h('form', {
    class: 'add',
    onsubmit: (e) => { e.preventDefault(); onAdd(name.value.trim(), price && price.value); },
  }, name, price, h('button', { type: 'submit' }, t('common.add')));
}

function mover(path, ids, id) {
  const move = (dir) => {
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    act(() => api('PUT', path, { ids: next }));
  };
  return h('span', { class: 'move' },
    h('button', { type: 'button', title: t('admin.moveUp'), onclick: () => move(-1) }, '↑'),
    h('button', { type: 'button', title: t('admin.moveDown'), onclick: () => move(1) }, '↓'));
}

function notes(list, owner) {
  return h('div', { class: 'notes' },
    list.map((m) => h('span', { class: 'chip' },
      nameInput(m.name, (v) => patch('modifiers', m.id, { name: v })),
      h('button', { type: 'button', title: t('common.delete'), onclick: () => remove('modifiers', m.id, m.name) }, '✕'))),
    addForm(t('admin.notes.add'), (name) => act(() => api('POST', '/api/admin/modifiers', { ...owner, name }))));
}

function addItem(categoryId, name, priceText) {
  const price_cents = parseMoney(priceText);
  if (price_cents === null) { alert(t('admin.error.price')); return; }
  return act(() => api('POST', '/api/admin/items', { category_id: categoryId, name, price_cents }));
}

// --- views ---
function itemRow(i, siblingIds) {
  return h('div', { class: i.sold_out ? 'row off' : 'row' },
    nameInput(i.name, (v) => patch('items', i.id, { name: v })),
    h('input', {
      type: 'text', inputmode: 'decimal', size: 6, value: formatDecimal(i.price_cents, language),
      onchange: (e) => {
        const cents = parseMoney(e.target.value);
        if (cents === null) { alert(t('admin.error.price')); refresh(); } else patch('items', i.id, { price_cents: cents });
      },
    }),
    symbol,
    check(t('admin.item.soldOut'), i.sold_out, (v) => patch('items', i.id, { sold_out: v })),
    h('button', { type: 'button', title: t('common.delete'), onclick: () => remove('items', i.id, i.name) }, '🗑'),
    mover('/api/admin/items/order', siblingIds, i.id),
    notes(state.modifiers.filter((m) => m.item_id === i.id), { item_id: i.id }));
}

function renderMenu() {
  const categoryIds = state.categories.map((c) => c.id);
  return [
    addForm(t('admin.category.name'), (name) => act(() => api('POST', '/api/admin/categories', { name }))),
    ...state.categories.map((c) => {
      const items = state.items.filter((i) => i.category_id === c.id);
      const itemIds = items.map((i) => i.id);
      return h('section', { class: c.active ? 'card' : 'card off' },
        h('header', {},
          nameInput(c.name, (v) => patch('categories', c.id, { name: v })),
          check(t('admin.active'), c.active, (v) => patch('categories', c.id, { active: v })),
          mover('/api/admin/categories/order', categoryIds, c.id),
          h('button', { type: 'button', title: t('common.delete'), onclick: () => remove('categories', c.id, c.name, 'admin.confirmDeleteCategory') }, '🗑')),
        h('div', {}, t('admin.notes'), notes(state.modifiers.filter((m) => m.category_id === c.id), { category_id: c.id })),
        items.map((i) => itemRow(i, itemIds)),
        addForm(t('admin.item.name'), (name, price) => addItem(c.id, name, price), true));
    }),
  ];
}

function renderOperators() {
  return [
    addForm(t('admin.operators.name'), (name) => act(() => api('POST', '/api/admin/operators', { name }))),
    ...state.operators.map((o) => h('div', { class: o.active ? 'row' : 'row off' },
      nameInput(o.name, (v) => patch('operators', o.id, { name: v })),
      check(t('admin.active'), o.active, (v) => patch('operators', o.id, { active: v })),
      h('button', { type: 'button', title: t('common.delete'), onclick: () => remove('operators', o.id, o.name) }, '🗑'))),
  ];
}

function render() {
  const tabs = ['menu', 'operators'].map((id) =>
    h('button', { type: 'button', class: state.tab === id ? 'on' : '', onclick: () => { state.tab = id; render(); } }, t(`admin.tab.${id}`)));
  app.replaceChildren(h('nav', { class: 'tabs' }, tabs), ...(state.tab === 'menu' ? renderMenu() : renderOperators()));
}

try {
  language = (await loadI18n()).language;
  await requirePin(app);
  symbol = currencySymbol(language, (await api('GET', '/api/config')).currency);
  await refresh();
} catch {
  app.textContent = t('common.error');
}
