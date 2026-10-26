// Pure helpers for the Workload screen. Every date is a 'YYYY-MM-DD' string;
// day maths goes through the timeline's epoch-day helpers, never a local Date,
// so the browser's time zone cannot move a task.
import { addDays, daysBetween, isoWeekday } from '../projects/detail/timeline/geometry.js';

export const NO_DATE = 'none';

// Only work the viewer may edit can be dragged (the server checks again).
export const canDrop = (item) => !!item?.canEdit;

// The request a drop turns into. A ticket gets the person and a planned date
// (the SLA due date never moves); a task gets the person and dates. A dated
// task keeps its length and starts on the drop day; an undated one gets that
// one day. The "No date" column only reassigns.
export function dropPatch(item, personId, date) {
  const dated = date && date !== NO_DATE;
  if (item.kind === 'ticket') {
    return { url: `/tickets/${item.id}`, body: dated ? { assigneeId: personId, plannedDate: date } : { assigneeId: personId } };
  }
  const url = `/projects/${item.projectId}/tasks/${item.id}`;
  if (!dated) return { url, body: { assigneeId: personId } };
  const start = item.startDate || item.dueDate;
  const due = item.dueDate || item.startDate;
  const length = start && due ? Math.max(0, daysBetween(start, due)) : 0;
  return { url, body: { assigneeId: personId, startDate: date, dueDate: addDays(date, length) } };
}

export const mondayOf = (date) => addDays(date, 1 - isoWeekday(date));

// Move the window by one range (5 or 10 weekdays = 1 or 2 weeks) either way.
export const shiftFrom = (from, days, direction) => addDays(from, (days / 5) * 7 * direction);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function parts(date) {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

export const monthDay = (date) => `${MONTHS[parts(date).m - 1]} ${parts(date).d}`;
export const rangeLabel = ([first, last]) => `${monthDay(first)} – ${monthDay(last)}`;
export const dayHeader = (date) => ({ weekday: WEEKDAYS[isoWeekday(date) - 1], day: parts(date).d });
export const longDay = (date) => `${WEEKDAYS[isoWeekday(date) - 1]}, ${monthDay(date)}`;

// 510 -> "8.5 h", 420 -> "7 h".
export function hoursLabel(minutes) {
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h} h`;
}

// off = a holiday or a day the person doesn't work (and nothing is booked);
// over = more booked than they have, which includes work landing on an off day.
export function cellState({ minutes, capacity }) {
  if (minutes > capacity) return 'over';
  if (capacity === 0) return 'off';
  return minutes === 0 ? 'free' : 'normal';
}
