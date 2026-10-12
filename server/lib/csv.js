// CSV for spreadsheets. The delimiter and the decimal mark follow the UI language
// (Italian Excel wants ";" and "1,20"). UTF-8 with BOM, so accents open correctly.
export function csvFormat(language) {
  const decimal = new Intl.NumberFormat(language).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? '.';
  const amount = new Intl.NumberFormat(language, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
  return { delimiter: decimal === ',' ? ';' : ',', money: (cents) => amount.format(cents / 100) };
}

// A text starting with = + - @ would be run as a formula by a spreadsheet: neutralise it.
const guard = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

// Cells: a number, a text, or { cents } for money.
export function toCsv(rows, { delimiter, money }) {
  const cell = (v) => {
    if (v !== null && typeof v === 'object' && 'cents' in v) return money(v.cents);
    if (typeof v === 'number') return String(v);
    const s = guard(String(v ?? ''));
    return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `\uFEFF${rows.map((r) => r.map(cell).join(delimiter)).join('\r\n')}\r\n`;
}
