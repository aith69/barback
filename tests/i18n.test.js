import test from 'node:test';
import assert from 'node:assert/strict';
import { createI18n, loadLocales } from '../server/i18n/index.js';

const locales = loadLocales();
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('English and Italian are present', () => {
  assert.ok(locales.en);
  assert.ok(locales.it);
});

test('every locale has exactly the keys of en.json, with the same placeholders', () => {
  const base = locales.en;
  for (const [code, messages] of Object.entries(locales)) {
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(base).sort(), `keys differ in ${code}.json`);
    for (const [key, text] of Object.entries(messages)) {
      assert.equal(typeof text, 'string', `${code}.json: ${key} is not a string`);
      assert.equal(placeholders(text), placeholders(base[key]), `${code}.json: placeholders differ in ${key}`);
    }
  }
});

test('translator interpolates, and falls back to English then to the key', () => {
  const it = createI18n(locales, 'it');
  assert.equal(it.t('table.title', { number: 7 }), 'Tavolo 7');
  assert.equal(it.t('no.such.key'), 'no.such.key');
  const xx = createI18n(locales, 'xx');
  assert.equal(xx.language, 'en');
  const partial = createI18n({ en: { a: 'A', b: 'B' }, de: { a: 'AA' } }, 'de');
  assert.equal(partial.t('a'), 'AA');
  assert.equal(partial.t('b'), 'B');
});
