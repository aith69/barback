// Money is handled as integer cents. Pure functions, no DOM: also used by tests.

// "1,20" / "1.2" / "3" -> cents, or null when not a valid amount.
export function parseMoney(text) {
  const s = String(text).trim().replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

// Plain number with the language's decimal separator, for input fields.
export const formatDecimal = (cents, language = 'en') =>
  new Intl.NumberFormat(language, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(cents / 100);

export const formatMoney = (cents, language = 'en', currency = 'EUR') =>
  new Intl.NumberFormat(language, { style: 'currency', currency }).format(cents / 100);

export const currencySymbol = (language = 'en', currency = 'EUR') =>
  new Intl.NumberFormat(language, { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
