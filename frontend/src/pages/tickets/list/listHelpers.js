// Constants and helpers for the ticket list: filters, columns, formatting.
import { IconDeviceDesktop, IconMail, IconPhone, IconWorld } from '@tabler/icons-react';
import { orgToday } from '../../../utils/orgDate';
import { fmtDateTime } from '../../../utils/formatDate';

// 'closed' is a special client-side aggregate keyword (the backend maps it
// to every behaviorType:'closed' status), not a literal status name — the
// real per-status options are appended dynamically from the fetched
// ticket-statuses list (see buildStatusFilterOptions below).
const BASE_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
];

export function buildStatusFilterOptions(ticketStatuses) {
  const openOnes = ticketStatuses.filter((s) => s.behaviorType !== 'closed').map((s) => ({ value: s.name, label: s.name }));
  // 'on_hold' is another aggregate: every on-hold status.
  return [...BASE_STATUS_OPTIONS, ...openOnes, { value: 'on_hold', label: 'On hold (all)' }, { value: 'closed', label: 'Closed' }];
}

export const PRIORITY_OPTIONS = [
  { value: '', label: 'All priorities' },
  { value: 'critical', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export const PRIORITY_META = {
  critical: { label: 'Urgent', color: 'var(--color-danger)' },
  high: { label: 'High', color: 'var(--color-warning)' },
  medium: { label: 'Medium', color: 'var(--color-accent)' },
  low: { label: 'Low', color: 'var(--color-text-muted)' },
};

// Hardcoded colors (not theme CSS variables) per spec — identifies how a
// ticket entered the system, should read the same regardless of theme.
export const SOURCE_META = {
  manual: { label: 'Manual', color: '#64748b', icon: null },
  email: { label: 'Email', color: '#2563eb', icon: IconMail },
  phone: { label: 'Phone', color: '#16a34a', icon: IconPhone },
  portal: { label: 'Portal', color: '#7c3aed', icon: IconWorld },
  // As on the ticket's own badge (detail/Badges.jsx): the PRISM agent's
  // tray, and tickets opened on a schedule. They read "Manual" before.
  agent: { label: 'PRISM tray', color: '#0e7490', icon: IconDeviceDesktop },
  recurring: { label: 'Recurring', color: '#64748b', icon: null },
};

export const FIXED_COLUMNS = ['id', 'title'];

export const DEFAULT_COLUMN_ORDER = [
  'requester', 'priority', 'status', 'category', 'dueDate', 'sla', 'assignee', 'type', 'source', 'team', 'timeLogged', 'createdDate', 'actions',
];

// Shown until a technician chooses their own under Columns (owner,
// 2026-11-13: the list had too much in it). Everything else is there to
// switch on; each technician's choice is kept in their browser.
export const DEFAULT_VISIBLE = ['requester', 'priority', 'status', 'category', 'sla', 'assignee'];

export const COLUMN_LABELS = {
  id: '#',
  title: 'Title',
  priority: 'Priority',
  requester: 'Requester',
  status: 'Status',
  category: 'Category',
  dueDate: 'Due date',
  sla: 'SLA',
  assignee: 'Assignee',
  type: 'Type',
  source: 'Source',
  team: 'Team',
  timeLogged: 'Time logged',
  createdDate: 'Created date',
  actions: 'Actions',
};

export const SORTABLE_COLUMNS = { id: 'id', title: 'title', priority: 'priority', status: 'status', dueDate: 'dueDate', createdDate: 'createdAt' };

export const COLUMN_STORAGE_KEY = 'prism.tickets.columns.v1';

// Custom field columns (prefixed "cf:") are only sortable when the
// underlying value is a simple, comparable scalar.
export const SORTABLE_CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'dropdown'];

export function formatCustomFieldValue(field, value) {
  if (value === undefined || value === null || value === '') return '—';
  if (field.fieldType === 'checkbox') return value === 'true' ? 'Yes' : 'No';
  if (field.fieldType === 'multiselect') return Array.isArray(value) ? value.join(', ') : String(value);
  if (field.fieldType === 'datetime') return fmtDateTime(value);
  return String(value);
}

export function todayStr() {
  return orgToday();
}

// `behaviorByName` is a Map<statusName, behaviorType> built from the
// fetched ticket-statuses list — a custom or renamed status is classified
// correctly immediately, since this reads live data rather than a fixed
// list of status name strings.
export function isClosedStatus(status, behaviorByName) {
  return behaviorByName.get(status) === 'closed';
}

export function ageDays(createdAt) {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
}

export function formatMinutes(min) {
  const m = Number(min) || 0;
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

// Column choices as saved (by the account, or an older copy in this
// browser) → what the list shows: unknown columns dropped, new ones added.
export function readColumnPrefs(parsed) {
  const defaults = { order: DEFAULT_COLUMN_ORDER, visible: Object.fromEntries(DEFAULT_COLUMN_ORDER.map((k) => [k, DEFAULT_VISIBLE.includes(k)])) };
  try {
    if (!parsed || typeof parsed !== 'object') return defaults;
    const order = Array.isArray(parsed.order) ? parsed.order.filter((k) => DEFAULT_COLUMN_ORDER.includes(k)) : DEFAULT_COLUMN_ORDER;
    // A column added since the preferences were saved goes where the default
    // order has it (after the column before it there), not at the far end.
    const merged = [...order];
    DEFAULT_COLUMN_ORDER.forEach((k, i) => {
      if (merged.includes(k)) return;
      const before = DEFAULT_COLUMN_ORDER.slice(0, i).reverse().find((b) => merged.includes(b));
      merged.splice(before ? merged.indexOf(before) + 1 : 0, 0, k);
    });
    // Someone who already chose their columns keeps them; only a column
    // they've never seen takes its default.
    const seen = parsed.visible || {};
    const visible = Object.fromEntries(DEFAULT_COLUMN_ORDER.map((k) => [k, k in seen ? !!seen[k] : (Object.keys(seen).length ? k === 'requester' || k === 'category' : defaults.visible[k])]));
    // Custom-field columns (cf:<key>) are chosen the same way; keep them.
    Object.keys(seen).filter((k) => k.startsWith('cf:')).forEach((k) => { visible[k] = !!seen[k]; });
    return { order: merged, visible };
  } catch {
    return defaults;
  }
}

// The copy this browser keeps, so the list draws with the right columns
// before the account's choice has loaded. The account's copy is the one
// that counts (see Tickets.jsx).
export function loadColumnPrefs() {
  try {
    return readColumnPrefs(JSON.parse(localStorage.getItem(COLUMN_STORAGE_KEY)));
  } catch {
    return readColumnPrefs(null);
  }
}

export function hasLocalColumnPrefs() {
  try { return !!localStorage.getItem(COLUMN_STORAGE_KEY); } catch { return false; }
}
