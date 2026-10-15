// Recurring ticket schedules (service desk 5b). Pure: no database, no clock.
//
// A rule runs at `timeOfDay` on the wall clock of `timezone`, on the dates
// its frequency produces, counted from `startDate`:
//   daily   — every `interval` days;
//   weekly  — on `weekdays` (0 = Sunday) of every `interval`-th week, weeks
//             starting on the Sunday of the start date's week;
//   monthly — on `dayOfMonth` of every `interval`-th month from the start
//             month, clamped to the month's last day (31 → Feb 28);
//   yearly  — on `monthOfYear`/`dayOfMonth` every `interval` years, clamped
//             the same way (Feb 29 → Feb 28 in other years).
// A wall time skipped by a spring-forward gap runs just after the gap, and
// one repeated by fall-back runs on its first pass (utils/orgTime).
const { ApiError } = require('../../middleware/error');
const {
  isValidZone, zoneWallTime, dateInZone, addDays, toDateString,
} = require('../../utils/orgTime');

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];
const DAY_MS = 86400000;

const dayNumber = (dateStr) => Date.UTC(...dateStr.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0))) / DAY_MS;
const fromDayNumber = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const ymd = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// The run dates of period k (k = 0, 1, …), in order.
function periodDates(rule, k) {
  const step = k * rule.interval;
  const [sy, sm] = rule.startDate.split('-').map(Number);
  switch (rule.frequency) {
    case 'daily': return [addDays(rule.startDate, step)];
    case 'weekly': {
      const start = dayNumber(rule.startDate);
      const sunday = start - new Date(start * DAY_MS).getUTCDay();
      return [...new Set(rule.weekdays)].sort((a, b) => a - b).map((wd) => fromDayNumber(sunday + step * 7 + wd));
    }
    case 'monthly': {
      const index = (sm - 1) + step;
      const y = sy + Math.floor(index / 12);
      const m = (index % 12) + 1;
      return [ymd(y, m, Math.min(rule.dayOfMonth, daysInMonth(y, m)))];
    }
    case 'yearly': {
      const y = sy + step;
      return [ymd(y, rule.monthOfYear, Math.min(rule.dayOfMonth, daysInMonth(y, rule.monthOfYear)))];
    }
    default: throw new Error(`Unknown frequency ${rule.frequency}`);
  }
}

// A period index a little before the one containing `dateStr`, so the scan
// doesn't start years back.
function firstPeriodNear(rule, dateStr) {
  const [sy, sm] = rule.startDate.split('-').map(Number);
  const [y, m] = dateStr.split('-').map(Number);
  let periods;
  switch (rule.frequency) {
    case 'daily': periods = dayNumber(dateStr) - dayNumber(rule.startDate); break;
    case 'weekly': periods = Math.floor((dayNumber(dateStr) - dayNumber(rule.startDate)) / 7); break;
    case 'monthly': periods = (y - sy) * 12 + (m - sm); break;
    default: periods = y - sy;
  }
  return Math.max(0, Math.floor(periods / rule.interval) - 1);
}

// The first run strictly after `after`, or null when the rule has ended.
function nextRun(rule, after) {
  const afterMs = new Date(after).getTime();
  const from = dateInZone(new Date(afterMs), rule.timezone);
  const scanFrom = from > rule.startDate ? from : rule.startDate;
  for (let k = firstPeriodNear(rule, scanFrom), guard = 0; guard < 1000; k += 1, guard += 1) {
    for (const date of periodDates(rule, k)) {
      if (date < rule.startDate) continue; // eslint-disable-line no-continue
      if (rule.endDate && date > rule.endDate) return null;
      const at = zoneWallTime(date, rule.timeOfDay, rule.timezone);
      if (at.getTime() > afterMs) return at;
    }
  }
  return null;
}

function previewRuns(rule, from, n = 5) {
  const runs = [];
  let cursor = new Date(from);
  while (runs.length < n) {
    const next = nextRun(rule, cursor);
    if (!next) break;
    runs.push(next);
    cursor = next;
  }
  return runs;
}

const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');
const intIn = (v, lo, hi) => Number.isInteger(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v)
  && Number(v) >= lo && Number(v) <= hi;

// Checks and normalises a schedule from a request. Fields that don't apply
// to the frequency are cleared.
function validateSchedule(input) {
  const s = input || {};
  if (!FREQUENCIES.includes(s.frequency)) throw bad('Frequency must be daily, weekly, monthly or yearly');
  if (!intIn(s.interval, 1, 365)) throw bad('Repeat every must be a whole number from 1 to 365');
  if (typeof s.timeOfDay !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.timeOfDay)) throw bad('Time must be HH:MM');
  if (!isValidZone(s.timezone)) throw bad('Unknown time zone');
  const startDate = toDateString(s.startDate);
  if (!startDate) throw bad('Start date is required');
  const endDate = s.endDate === null || s.endDate === undefined || s.endDate === '' ? null : toDateString(s.endDate);
  if (endDate === null && s.endDate) throw bad('End date is not a date');
  if (endDate && endDate < startDate) throw bad('End date is before the start date');
  const out = {
    frequency: s.frequency,
    interval: Number(s.interval),
    weekdays: null,
    dayOfMonth: null,
    monthOfYear: null,
    timeOfDay: s.timeOfDay,
    timezone: s.timezone,
    startDate,
    endDate,
  };
  if (s.frequency === 'weekly') {
    if (!Array.isArray(s.weekdays) || !s.weekdays.length || !s.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
      throw bad('Choose at least one weekday');
    }
    out.weekdays = [...new Set(s.weekdays)].sort((a, b) => a - b);
  }
  if (s.frequency === 'monthly' || s.frequency === 'yearly') {
    if (!intIn(s.dayOfMonth, 1, 31)) throw bad('Day of month must be 1 to 31');
    out.dayOfMonth = Number(s.dayOfMonth);
  }
  if (s.frequency === 'yearly') {
    if (!intIn(s.monthOfYear, 1, 12)) throw bad('Month must be 1 to 12');
    out.monthOfYear = Number(s.monthOfYear);
  }
  return out;
}

module.exports = { nextRun, previewRuns, validateSchedule, FREQUENCIES };
