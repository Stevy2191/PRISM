// Business-time arithmetic for SLA clocks. Pure: no database.
//
// `calendar` is { timezone, schedule, is24x7, holidays: Set<'YYYY-MM-DD'> }
// or null. null (or is24x7) means every minute counts. `schedule` is the
// BusinessHours.schedule shape: { monday: { start: '09:00', end: '17:00',
// enabled }, … }. A disabled or missing day, a holiday, or a day whose end
// is not after its start is closed. Days are walked in the schedule's zone,
// so daylight-saving days count their real open minutes.
const { dateInZone, zoneWallTime, addDays } = require('../../utils/orgTime');

const MINUTE = 60 * 1000;
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// Ten years of closed days means the schedule has no open time at all.
const MAX_DAYS = 3700;

function isWallClock(calendar) {
  return !calendar || calendar.is24x7;
}

// [openMs, closeMs] for `dateStr` in the calendar's zone, or null if closed.
function openWindow(dateStr, calendar) {
  if (calendar.holidays && calendar.holidays.has(dateStr)) return null;
  const dayName = DAY_NAMES[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
  const day = calendar.schedule && calendar.schedule[dayName];
  if (!day || !day.enabled || !day.start || !day.end) return null;
  const open = zoneWallTime(dateStr, day.start, calendar.timezone).getTime();
  const close = zoneWallTime(dateStr, day.end, calendar.timezone).getTime();
  return close > open ? [open, close] : null;
}

function addBusinessMinutes(start, minutes, calendar) {
  const startMs = new Date(start).getTime();
  if (isWallClock(calendar)) return new Date(startMs + minutes * MINUTE);
  if (minutes <= 0) return new Date(startMs);

  let remaining = minutes * MINUTE;
  let day = dateInZone(new Date(startMs), calendar.timezone);
  for (let i = 0; i < MAX_DAYS; i += 1) {
    const w = openWindow(day, calendar);
    if (w) {
      const from = Math.max(w[0], startMs);
      if (from < w[1]) {
        const available = w[1] - from;
        if (remaining <= available) return new Date(from + remaining);
        remaining -= available;
      }
    }
    day = addDays(day, 1);
  }
  throw new Error('Business-hours schedule has no open hours');
}

function businessMinutesBetween(a, b, calendar) {
  const aMs = new Date(a).getTime();
  const bMs = new Date(b).getTime();
  if (bMs <= aMs) return 0;
  if (isWallClock(calendar)) return Math.round((bMs - aMs) / MINUTE);

  let total = 0;
  const lastDay = dateInZone(new Date(bMs), calendar.timezone);
  for (let day = dateInZone(new Date(aMs), calendar.timezone); day <= lastDay; day = addDays(day, 1)) {
    const w = openWindow(day, calendar);
    if (w) {
      const from = Math.max(w[0], aMs);
      const to = Math.min(w[1], bMs);
      if (to > from) total += to - from;
    }
  }
  return Math.round(total / MINUTE);
}

// 'HH:MM' on the zone's wall clock at `ms`.
function wallClock(ms, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${parts.hour}:${parts.minute}`;
}

// The same wall-clock time `days` open days later. A start outside open
// hours counts from the next opening; a time past that day's closing lands
// at closing (before its opening, at opening). 24x7 / null: calendar days.
function addBusinessDays(start, days, calendar) {
  const startMs = new Date(start).getTime();
  if (isWallClock(calendar)) return new Date(startMs + days * 24 * 60 * MINUTE);

  let day = dateInZone(new Date(startMs), calendar.timezone);
  let anchor = null;
  for (let i = 0; i < MAX_DAYS && anchor === null; i += 1) {
    const w = openWindow(day, calendar);
    if (w && startMs < w[1]) anchor = Math.max(w[0], startMs);
    else day = addDays(day, 1);
  }
  if (anchor === null) throw new Error('Business-hours schedule has no open hours');
  if (days <= 0) return new Date(anchor);

  const time = wallClock(anchor, calendar.timezone);
  const seconds = anchor % MINUTE;
  let left = days;
  for (let i = 0; left > 0; i += 1) {
    if (i >= MAX_DAYS) throw new Error('Business-hours schedule has no open hours');
    day = addDays(day, 1);
    if (openWindow(day, calendar)) left -= 1;
  }
  const [open, close] = openWindow(day, calendar);
  const target = zoneWallTime(day, time, calendar.timezone).getTime() + seconds;
  return new Date(Math.min(close, Math.max(open, target)));
}

module.exports = { addBusinessMinutes, businessMinutesBetween, addBusinessDays };
