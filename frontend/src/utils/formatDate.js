// One way to write a date everywhere (owner, 2026-11-12): "Nov 12, 2026",
// and "Nov 12, 2026, 3:23 PM" with a time. Before, screens mixed
// 2026-11-12, 11/12/2026 and Nov 12, 2026.
const DATE = { year: 'numeric', month: 'short', day: 'numeric' };
const TIME = { hour: 'numeric', minute: '2-digit' };
const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// A date-only value ("2026-11-12") names a calendar day, not an instant:
// read as local, so it never shows as the day before west of UTC.
function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const m = typeof value === 'string' ? DAY_ONLY.exec(value) : null;
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "Nov 12, 2026"; `empty` for no (or an unreadable) date.
export function fmtDate(value, empty = '—') {
  const d = toDate(value);
  return d ? d.toLocaleDateString('en-US', DATE) : empty;
}

// "Nov 12, 2026, 3:23 PM".
export function fmtDateTime(value, empty = '—') {
  const d = toDate(value);
  return d ? d.toLocaleString('en-US', { ...DATE, ...TIME }) : empty;
}
