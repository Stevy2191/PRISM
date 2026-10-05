// Constants and helpers for the ticket list: filters, columns, formatting.
import { IconMail, IconPhone, IconWorld } from '@tabler/icons-react';

// 'closed' is a special client-side aggregate keyword (the backend maps it
// to every behaviorType:'closed' status), not a literal status name — the
// real per-status options are appended dynamically from the fetched
// ticket-statuses list (see buildStatusFilterOptions below).
const BASE_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
];

export function buildStatusFilterOptions(ticketStatuses) {
  const openOnes = ticketStatuses.filter((s) => s.behaviorType !== 'closed').map((s) => ({ value: s.name, label: s.name }));
  return [...BASE_STATUS_OPTIONS, ...openOnes, { value: 'closed', label: 'Closed' }];
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
};

export const FIXED_COLUMNS = ['id', 'title'];

export const DEFAULT_COLUMN_ORDER = [
  'priority', 'status', 'dueDate', 'assignee', 'type', 'source', 'team', 'timeLogged', 'createdDate', 'actions',
];

export const COLUMN_LABELS = {
  id: '#',
  title: 'Title',
  priority: 'Priority',
  status: 'Status',
  dueDate: 'Due date',
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
  if (field.fieldType === 'datetime') return new Date(value).toLocaleString();
  return String(value);
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
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

export function loadColumnPrefs() {
  const defaults = { order: DEFAULT_COLUMN_ORDER, visible: Object.fromEntries(DEFAULT_COLUMN_ORDER.map((k) => [k, true])) };
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const order = Array.isArray(parsed.order) ? parsed.order.filter((k) => DEFAULT_COLUMN_ORDER.includes(k)) : DEFAULT_COLUMN_ORDER;
    const missing = DEFAULT_COLUMN_ORDER.filter((k) => !order.includes(k));
    return { order: [...order, ...missing], visible: { ...defaults.visible, ...(parsed.visible || {}) } };
  } catch {
    return defaults;
  }
}
