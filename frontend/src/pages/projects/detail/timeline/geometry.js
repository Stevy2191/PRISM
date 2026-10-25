// Pure geometry for the project timeline. Every date is a 'YYYY-MM-DD' string;
// day maths goes through UTC epoch days (never a local-time Date), so the
// browser's time zone and DST cannot move a bar.

export const ZOOM = { week: 30, month: 12, quarter: 4 }; // px per day

const MS_DAY = 86400000;

export function toEpochDay(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
}

export function fromEpochDay(day) {
  const dt = new Date(day * MS_DAY);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const addDays = (date, n) => fromEpochDay(toEpochDay(date) + n);
export const daysBetween = (a, b) => toEpochDay(b) - toEpochDay(a);
// 1 = Monday ... 7 = Sunday (epoch day 0 was a Thursday).
export const isoWeekday = (date) => (((toEpochDay(date) + 3) % 7) + 7) % 7 + 1;
export const isWeekend = (date) => isoWeekday(date) >= 6;

// `from` is the first day drawn, `days` how many days the chart covers.
export function layout({ from, days, zoom }) {
  const start = toEpochDay(from);
  return {
    from,
    days,
    zoom,
    width: days * zoom,
    dayToX: (date) => (toEpochDay(date) - start) * zoom,
    xToDay: (px) => fromEpochDay(start + Math.floor(px / zoom)),
  };
}

// A task's drawn span; a task with only one date is a single day.
export function spanOf(task) {
  const startDate = task.startDate || task.dueDate;
  const dueDate = task.dueDate || task.startDate;
  return startDate ? { startDate, dueDate } : null;
}

// null when the task has no date at all (it is listed under "Not scheduled").
export function barRect(task, lay) {
  const span = spanOf(task);
  if (!span) return null;
  return {
    x: lay.dayToX(span.startDate),
    width: (daysBetween(span.startDate, span.dueDate) + 1) * lay.zoom,
  };
}

// New dates after dragging by dayDelta days. Never start > due; a milestone
// (one day, only ever moves) treats every mode as a move.
export function dragResult(task, mode, dayDelta) {
  const { startDate, dueDate } = spanOf(task);
  if (mode === 'move' || task.isMilestone) {
    return { startDate: addDays(startDate, dayDelta), dueDate: addDays(dueDate, dayDelta) };
  }
  if (mode === 'start') {
    const moved = addDays(startDate, dayDelta);
    return { startDate: moved > dueDate ? dueDate : moved, dueDate };
  }
  const moved = addDays(dueDate, dayDelta);
  return { startDate, dueDate: moved < startDate ? startDate : moved };
}

// Orthogonal connector from the end of one bar to the start of another.
// Rects are { x, width, y } with y the row's vertical centre; rowGap is the
// row height, used to step through the gap between rows when the target
// starts before the source ends.
export function arrowPath(fromRect, toRect, rowGap) {
  const x1 = fromRect.x + fromRect.width;
  const y1 = fromRect.y;
  const x2 = toRect.x;
  const y2 = toRect.y;
  if (x2 - 8 >= x1 + 8) return `M${x1} ${y1} H${x1 + 8} V${y2} H${x2}`;
  const gapY = y1 + (y2 >= y1 ? rowGap / 2 : -rowGap / 2);
  return `M${x1} ${y1} H${x1 + 8} V${gapY} H${x2 - 8} V${y2} H${x2}`;
}

// "Thu, Nov 12" for a date string, formatted in UTC so the day cannot slip.
const FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const FMT_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const FMT_MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const at = (date) => new Date(toEpochDay(date) * MS_DAY);
export const formatDay = (date) => FMT.format(at(date));
export const formatShort = (date) => FMT_SHORT.format(at(date));
export const formatMonth = (date) => FMT_MONTH.format(at(date));

// The range to draw: the tasks' dates and today, padded, starting on a Monday.
export function chartRange(tasks, phases, today) {
  const dates = [today];
  [...tasks, ...phases].forEach((t) => { if (t.startDate) dates.push(t.startDate); if (t.dueDate) dates.push(t.dueDate); });
  const lo = dates.reduce((a, b) => (a < b ? a : b));
  const hi = dates.reduce((a, b) => (a > b ? a : b));
  const from = addDays(lo, -(isoWeekday(lo) - 1) - 7);
  const days = Math.max(daysBetween(from, hi) + 21, 56);
  return { from, days };
}
