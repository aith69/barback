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

export async function loadI18n() {
  const res = await fetch('/api/i18n');
  const data = await res.json();
  messages = data.messages;
  document.documentElement.lang = data.language;
  applyI18n();
  return data;
}
