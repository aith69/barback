// Client i18n: the language is decided by the server config, never by the browser.
let messages = {};

export function t(key, params = {}) {
  return (messages[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
}

// Every page except the start page gets a "home" bar, to switch between areas.
function mountHomeBar() {
  if (location.pathname === '/' || document.querySelector('.homebar')) return;
  const link = document.createElement('a');
  link.href = '/';
  link.textContent = `⌂ ${t('common.home')}`;
  const bar = document.createElement('nav');
  bar.className = 'homebar';
  bar.append(link);
  document.body.prepend(bar);
}

export async function loadI18n() {
  const res = await fetch('/api/i18n');
  const data = await res.json();
  messages = data.messages;
  document.documentElement.lang = data.language;
  mountHomeBar();
  applyI18n();
  return data;
}
