// Colors (admin-customizable theme CSS variables), the input style and small
// formatters shared by the ticket pages.

// Colors read from the admin-customizable theme CSS variables (Settings -> Appearance).
export const BG = 'var(--color-bg)';

export const CARD_BG = 'var(--color-card)';

export const BORDER = 'var(--color-border)';

export const TEXT = 'var(--color-text-primary)';

export const MUTED = 'var(--color-text-muted)';

export const BLUE = 'var(--color-accent)';

export const TIMER_COLOR = 'var(--color-timer)';

export const PURPLE = 'var(--color-relation-accent)';

export const PURPLE_LIGHT = 'var(--color-relation-accent-light)';

export const PRIORITY_META = {
  critical: { label: 'Urgent', color: 'var(--color-danger)' },
  high: { label: 'High', color: 'var(--color-warning)' },
  medium: { label: 'Medium', color: 'var(--color-accent)' },
  low: { label: 'Low', color: 'var(--color-text-muted)' },
};

export function formatMinutes(min) {
  const m = Number(min) || 0;
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

export function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(dateStr);
}

// dueTime is a nullable "HH:MM:SS" TIME column companion to dueDate — only
// meaningful (and only ever set) when dueDate is also set.
export function formatDueDateTime(dueDate, dueTime) {
  if (!dueDate) return 'None';
  if (!dueTime) return dueDate;
  const [h, m] = dueTime.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${dueDate} ${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// Combines a YYYY-MM-DD date with minutes-since-midnight into a local
// datetime string suitable for `new Date(...)` on either side of the wire —
// only the DIFFERENCE between two such values is ever used, so timezone
// offset doesn't matter as long as both are constructed the same way.
export function buildLocalDateTime(dateStr, minutesOfDay) {
  const h = Math.floor(minutesOfDay / 60);
  const m = minutesOfDay % 60;
  return `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

export const fieldStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT };

export const AMBER = 'var(--color-warning)';
