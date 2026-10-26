// Workload maths (sub-project 6): who has how many minutes on which day. Pure
// functions on plain values; dates are 'YYYY-MM-DD' strings and all day maths
// goes through projects/schedule (UTC epoch days), never Date arithmetic.
const { addDays, daysBetween, isoWeekday } = require('../projects/schedule');

// Minutes per ISO weekday ('1' = Monday ... '7' = Sunday).
const DEFAULT_WORK_HOURS = {
  1: 480, 2: 480, 3: 480, 4: 480, 5: 480, 6: 0, 7: 0,
};
const DEFAULT_TICKET_MINUTES = 60;
const NONE = 'none';

// A strict calendar date: 'YYYY-MM-DD' that really exists (no 2026-02-30).
function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return addDays(value, 0) === value;
}

// A work-hours object ({"1": 480, ...}) checked: plain object, keys '1'..'7'
// only, whole minutes 0-1440. Returns the cleaned object, or null if invalid.
function validWorkHours(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [key, minutes] of Object.entries(value)) {
    if (!/^[1-7]$/.test(key) || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440) return null;
    out[key] = minutes;
  }
  return out;
}

// Minutes a person works on `date`: their own hours, else the defaults; a
// holiday takes the whole day off.
function capacityFor(workHours, defaults, holidays, date) {
  if (holidays && holidays.has(date)) return 0;
  const hours = workHours || defaults || DEFAULT_WORK_HOURS;
  const minutes = Number(hours[isoWeekday(date)]);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

// Splits `minutes` into `parts` whole-minute pieces; the last takes the remainder.
function evenSplit(minutes, parts) {
  const each = Math.floor(minutes / parts);
  return Array.from({ length: parts }, (_, i) => (i === parts - 1 ? minutes - each * (parts - 1) : each));
}

// The ISO weekdays (Mon-Fri only: weekend hours never take a share) a person
// works, from their own hours or the defaults.
function workingWeekdays(workHours, defaults) {
  const hours = workHours || defaults || DEFAULT_WORK_HOURS;
  return new Set([1, 2, 3, 4, 5].filter((wd) => Number(hours[wd]) > 0));
}

// The working days in an item's window [max(start, today), due], worked out
// arithmetically however long the window is (a two-year task spreads over two
// years of working days, not one): `count` of them, the `last` one (it takes
// the rounding remainder) and, listed, only the `days` inside `range`
// ([first, last] visible dates). A working day is one of `workdays` (ISO
// weekdays) that isn't in `holidays`; every future holiday is loaded, so the
// count is exact. No start, no due, or a due date before today: count 0.
function workingSpan(startDate, dueDate, today, workdays, holidays, range) {
  const empty = { count: 0, last: null, days: [] };
  if (!startDate || !dueDate || dueDate < today) return empty;
  const lo = startDate > today ? startDate : today;
  if (lo > dueDate || !workdays.size) return empty;
  const isWorking = (d) => workdays.has(isoWeekday(d)) && !(holidays && holidays.has(d));
  const n = daysBetween(lo, dueDate) + 1;
  let count = Math.floor(n / 7) * workdays.size;
  const firstWd = isoWeekday(lo);
  for (let i = 0; i < n % 7; i += 1) if (workdays.has(((firstWd - 1 + i) % 7) + 1)) count += 1;
  for (const h of holidays || []) if (h >= lo && h <= dueDate && workdays.has(isoWeekday(h))) count -= 1;
  if (count <= 0) return empty;
  let last = dueDate;
  while (!isWorking(last)) last = addDays(last, -1);
  const days = [];
  const hi = range && range[1] < dueDate ? range[1] : dueDate;
  for (let d = range && range[0] > lo ? range[0] : lo; d <= hi; d = addDays(d, 1)) if (isWorking(d)) days.push(d);
  return { count, last, days };
}

// Where an item's minutes fall. `working` is the person's workingSpan() for
// the item (or, simply, a sorted list of their working dates covering the
// window). Returns Map<date | 'none', minutes>; only listed days appear.
//  - no dates: 'none'
//  - past due: all on today
//  - due only: all on the due date
//  - otherwise even over the working days in [max(start, today), due], or all
//    on the due date when that window has none.
// A start date with no due date sits on max(start, today).
function spread(minutes, startDate, dueDate, working, today) {
  const out = new Map();
  if (!startDate && !dueDate) return out.set(NONE, minutes);
  if (!dueDate) return out.set(startDate > today ? startDate : today, minutes);
  if (dueDate < today) return out.set(today, minutes);
  if (!startDate) return out.set(dueDate, minutes);
  const lo = startDate > today ? startDate : today;
  let span = working;
  if (Array.isArray(working)) {
    const days = lo > dueDate ? [] : working.filter((d) => d >= lo && d <= dueDate);
    span = { count: days.length, last: days[days.length - 1], days };
  }
  if (!span.count) return out.set(dueDate, minutes);
  const each = Math.floor(minutes / span.count);
  span.days.forEach((d) => out.set(d, d === span.last ? minutes - each * (span.count - 1) : each));
  return out;
}

// The screen shows Monday-Friday only. A day that is a Saturday or Sunday
// shows as the Friday before (a single-day landing), or as the coming Monday
// when it is "today" (work that is due now starts on the next working day).
function snapBack(date) {
  const wd = isoWeekday(date);
  return wd <= 5 ? date : addDays(date, 5 - wd);
}
function snapForward(date) {
  const wd = isoWeekday(date);
  return wd <= 5 ? date : addDays(date, 8 - wd);
}

// Work still to do on an item, in minutes.
//  - task: its estimate less everyone's logged time, never below 0
//  - ticket: the sum of its open tasks' remaining estimates, or the default
//    ticket size when it has no open task (or none carries an estimate)
const remaining = (t) => Math.max((Number(t.estimateMinutes) || 0) - (Number(t.loggedMinutes) || 0), 0);
function itemMinutes(item, defaultTicketMinutes = DEFAULT_TICKET_MINUTES) {
  if (item.kind === 'task') return remaining(item);
  const sum = (item.tasks || []).reduce((n, t) => n + remaining(t), 0);
  return sum > 0 ? sum : defaultTicketMinutes;
}

// An even split between the people on an item; the last takes the remainder.
function shareMinutes(minutes, peopleIds) {
  const out = new Map();
  if (!peopleIds.length) return out;
  evenSplit(minutes, peopleIds.length).forEach((m, i) => out.set(peopleIds[i], m));
  return out;
}

module.exports = {
  DEFAULT_WORK_HOURS, DEFAULT_TICKET_MINUTES, NONE, isIsoDate, validWorkHours, snapBack, snapForward, capacityFor, workingWeekdays, workingSpan, spread, itemMinutes, shareMinutes,
};
