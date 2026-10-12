import fs from 'node:fs';
import path from 'node:path';
import { root } from '../config.js';

export const FALLBACK = 'en';
export const localesDir = path.join(root, 'locales');

// locales/<code>.json: flat { "section.key": "text with {placeholders}" }
export function loadLocales(dir = localesDir) {
  const locales = {};
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    locales[path.basename(file, '.json')] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  }
  return locales;
}

// Unknown language falls back to English. Missing keys fall back to English, then to the key itself.
export function createI18n(locales, language) {
  const used = locales[language] ? language : FALLBACK;
  const messages = { ...locales[FALLBACK], ...locales[used] };
  const t = (key, params = {}) =>
    (messages[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return { language: used, messages, t };
}
