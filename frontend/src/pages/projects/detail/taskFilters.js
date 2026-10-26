// Pure helpers behind the project Tasks tab: filter pills, grouping by phase,
// day maths and the row texts. Dates are 'YYYY-MM-DD' strings throughout;
// `today` is the organization's date as such a string (no Date maths across
// time zones).
import { orgToday } from '../../../utils/orgDate.js';

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'done', label: 'Done' },
];

// A task with subtasks is done when they all are; the server says so.
export const isDone = (task) => (task.isComplete != null ? !!task.isComplete : task.status?.behaviorType === 'closed');

// Mine: I'm the main assignee or a helper on the task or on any of its
// subtasks (as the server's mine filter and the phone list count it).
const onIt = (task, userId) => task.assigneeId === userId || (task.helpers || []).some((h) => h.id === userId);
const isMine = (task, userId) => onIt(task, userId) || (task.subtasks || []).some((s) => onIt(s, userId));

export function filterTasks(tasks, filter, { userId, today } = {}) {
  switch (filter) {
    case 'mine': return tasks.filter((t) => isMine(t, userId));
    case 'waiting': return tasks.filter((t) => !isDone(t) && (t.waitingOn || []).length > 0);
    case 'overdue': return tasks.filter((t) => !isDone(t) && !!t.dueDate && t.dueDate < today);
    case 'unassigned': return tasks.filter((t) => !isDone(t) && !t.assigneeId);
    case 'done': return tasks.filter(isDone);
    default: return tasks;
  }
}

// [{ phase, tasks }] in phase order, empty phases kept; tasks without a phase
// come last as { phase: null } (only when there are any).
export function groupByPhase(tasks, phases) {
  const sorted = [...phases].sort((a, b) => (a.position - b.position) || (a.id - b.id));
  const groups = sorted.map((phase) => ({ phase, tasks: tasks.filter((t) => t.phaseId === phase.id) }));
  const known = new Set(sorted.map((p) => p.id));
  const loose = tasks.filter((t) => !known.has(t.phaseId));
  if (loose.length) groups.push({ phase: null, tasks: loose });
  return groups;
}

const dayNumber = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

// Whole days from `today` to `date` (negative once passed).
export function daysUntil(today, date) {
  return Math.round(dayNumber(date) - dayNumber(today));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(date) {
  if (!date) return '';
  const [, m, d] = date.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function dateRange(start, end) {
  const a = shortDate(start);
  const b = shortDate(end);
  if (a && b && a !== b) return `${a} – ${b}`;
  return a || b;
}

// Main assignee first, then helpers, each person once: [{ id, name }].
export function rowPeople(task) {
  const people = [];
  if (task.assigneeId) people.push({ id: task.assigneeId, name: task.assignee?.displayName || task.assignee?.username || 'Unknown' });
  for (const h of task.helpers || []) {
    if (!people.some((p) => p.id === h.id)) people.push({ id: h.id, name: h.name });
  }
  return people;
}

// Hours with at most one decimal: 3, 1.5.
export const hoursFromSeconds = (s) => `${Math.round(((Number(s) || 0) / 3600) * 10) / 10}`;
export const hoursFromMinutes = (m) => `${Math.round(((Number(m) || 0) / 60) * 10) / 10}`;

// Person-hours: "3 h logged by 2 people" when more than one person logged,
// else "logged / estimate h" (or just the logged hours without an estimate).
export function loggedText(task) {
  if (task.isMilestone) return 'Milestone';
  if (task.loggedBy > 1) return `${hoursFromSeconds(task.loggedSeconds)} h logged by ${task.loggedBy} people`;
  if (task.estimateMinutes != null) return `${hoursFromSeconds(task.loggedSeconds)} / ${hoursFromMinutes(task.estimateMinutes)} h`;
  return `${hoursFromSeconds(task.loggedSeconds)} h`;
}

// Today on the organization's calendar (what "today" means for overdue).
export function localToday() {
  return orgToday();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "Sat, Nov 14" from a date string.
export function weekdayDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${shortDate(date)}`;
}

// "in 11 days", "tomorrow", "today", "3 days ago".
export function inDays(n) {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

// The last part of a task code: IT-P00042-T17 -> T17.
export const shortCode = (code) => (code ? code.split('-').pop() : '');
