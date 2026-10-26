// The organization's calendar: Settings → company.timezone (an IANA zone,
// default UTC). Work dates ("today", a timer's day) and report day bounds are
// computed in it, not in the server's zone or the browser's.

function isValidZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }); // eslint-disable-line no-new
    return true;
  } catch {
    return false;
  }
}

// Read per call (one indexed row): a settings change applies at once.
async function orgTimeZone({ transaction } = {}) {
  const { SystemSettings } = require('../models'); // eslint-disable-line global-require
  const row = await SystemSettings.findOne({ where: { key: 'company.timezone' }, attributes: ['value'], transaction });
  const tz = row && row.value ? String(row.value).trim() : 'UTC';
  return isValidZone(tz) ? tz : 'UTC';
}

// YYYY-MM-DD of an instant, as a wall calendar in `tz` shows it.
function dateInZone(instant, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(instant));
}

function todayInZone(tz, now = new Date()) {
  return dateInZone(now, tz);
}

// How far `tz`'s wall clock is ahead of UTC at `instant`, in milliseconds.
function offsetAt(instant, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).map((p) => [p.type, p.value]));
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

// The UTC instant at which `dateStr` (YYYY-MM-DD) begins in `tz`.
function zoneDayStart(dateStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const midnightUtc = Date.UTC(y, m - 1, d);
  let guess = midnightUtc - offsetAt(new Date(midnightUtc), tz);
  // A second pass settles the days on which the offset changes (DST).
  guess = midnightUtc - offsetAt(new Date(guess), tz);
  return new Date(guess);
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// The last millisecond of `dateStr` in `tz`.
function zoneDayEnd(dateStr, tz) {
  return new Date(zoneDayStart(addDays(dateStr, 1), tz).getTime() - 1);
}

// The UTC instant at which the wall clock in `tz` reads `hhmm` ('HH:MM') on
// `dateStr`. A time skipped by a spring-forward gap lands just after the
// gap (02:30 → 03:30); an hour repeated by fall-back takes its first pass.
function zoneWallTime(dateStr, hhmm, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const wallUtc = Date.UTC(y, m - 1, d, hh, mm);
  const first = wallUtc - offsetAt(new Date(wallUtc), tz);
  const second = wallUtc - offsetAt(new Date(first), tz);
  // In a gap the second pass falls back before it; keep the first guess.
  return new Date(second + offsetAt(new Date(second), tz) === wallUtc ? second : first);
}

// 'HH:MM' on the wall clock of `tz` at `instant`.
function timeInZone(instant, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return `${parts.hour}:${parts.minute}`;
}

// A real calendar date as YYYY-MM-DD (also the date part of an ISO
// timestamp), or null. '2026-02-30' is refused, not rolled into March.
function toDateString(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const parsed = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === s ? s : null;
}

// "Today" on the organization's calendar. Overdue, expiring-soon and
// default-date checks use this, never the UTC date (which is already
// tomorrow during a US evening).
async function orgToday(opts) {
  return todayInZone(await orgTimeZone(opts));
}

// The day a value falls on in `tz`. A DATEONLY string is already a day.
function dayOf(value, tz) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return dateInZone(value, tz);
}

// Report chart bucket for a value: its day, its week's Monday, or its month.
function periodKey(value, granularity, tz) {
  const day = dayOf(value, tz);
  if (granularity === 'month') return day.slice(0, 7);
  if (granularity === 'week') return addDays(day, 1 - (new Date(`${day}T00:00:00Z`).getUTCDay() || 7));
  return day;
}

module.exports = {
  orgToday, dayOf, periodKey, orgTimeZone, isValidZone, dateInZone, todayInZone, zoneDayStart, zoneDayEnd, zoneWallTime, timeInZone, addDays, toDateString,
};
