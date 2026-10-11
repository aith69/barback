import test from 'node:test';
import assert from 'node:assert/strict';
import { currencySymbol, formatDecimal, formatMoney, parseMoney } from '../web/shared/money.js';

test('parseMoney accepts comma or dot and returns cents', () => {
  assert.equal(parseMoney('1,20'), 120);
  assert.equal(parseMoney('1.2'), 120);
  assert.equal(parseMoney(' 3 '), 300);
  assert.equal(parseMoney('0,05'), 5);
  assert.equal(parseMoney('12.50'), 1250);
});

test('parseMoney rejects invalid amounts', () => {
  for (const bad of ['', 'abc', '-1', '1,234', '1.2.3', '1e3', '1,5€']) {
    assert.equal(parseMoney(bad), null, `"${bad}" should be rejected`);
  }
});

test('formatting follows the configured language', () => {
  const plain = (s) => s.replace(/\s/g, ' ');
  assert.equal(formatDecimal(120, 'it'), '1,20');
  assert.equal(formatDecimal(120, 'en'), '1.20');
  assert.equal(plain(formatMoney(120, 'it', 'EUR')), '1,20 €');
  assert.equal(plain(formatMoney(120, 'en', 'EUR')), '€1.20');
  assert.equal(currencySymbol('it', 'EUR'), '€');
});
