// Table and card cells for the ticket list.
import PersonAvatar from '../../../components/ui/Avatar';
import { TEXT, MUTED } from '../theme';
import { PRIORITY_META, SOURCE_META, todayStr, isClosedStatus, ageDays } from './listHelpers';
import { addDays } from '../../../utils/orgDate';

export function Avatar({ name }) {
  if (!name) {
    return <span className="text-sm" style={{ color: MUTED }}>Unassigned</span>;
  }
  return (
    <span className="flex items-center gap-2">
      <PersonAvatar name={name} size={22} />
      <span className="truncate text-sm" style={{ color: TEXT }}>{name}</span>
    </span>
  );
}

export function PriorityCell({ priority }) {
  const meta = PRIORITY_META[priority] || PRIORITY_META.medium;
  return (
    <span className="flex items-center gap-2 text-sm" style={{ color: TEXT }}>
      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </span>
  );
}

export function SourceCell({ source }) {
  const meta = SOURCE_META[source] || SOURCE_META.manual;
  const Icon = meta.icon;
  return (
    <span className="flex w-fit items-center gap-1.5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
      {Icon && <Icon size={13} aria-hidden="true" />}
      {meta.label}
    </span>
  );
}

// Colored from the status's own `color` field (set on Settings -> Statuses),
// not a hardcoded name-to-color map — so a custom status renders correctly
// with no code change.
export function StatusBadge({ ticket, ticketStatuses }) {
  const meta = ticketStatuses.find((s) => s.name === ticket.status);
  const color = meta?.color || MUTED;
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
    >
      {ticket.status}
    </span>
  );
}

export function DueDateCell({ dueDate }) {
  if (!dueDate) return <span className="text-sm" style={{ color: MUTED }}>—</span>;
  const today = todayStr();
  const soonStr = addDays(today, 3);
  let color = MUTED;
  if (dueDate < today) color = 'var(--color-danger)';
  else if (dueDate <= soonStr) color = 'var(--color-warning)';
  return <span className="num whitespace-nowrap text-sm" style={{ color }}>{dueDate}</span>;
}

export function AgeLine({ ticket, behaviorByName }) {
  if (isClosedStatus(ticket.status, behaviorByName)) return null;
  const days = ageDays(ticket.createdAt);
  let color = MUTED;
  if (days > 10) color = 'var(--color-danger)';
  else if (days > 5) color = 'var(--color-warning)';
  return <p className="text-xs" style={{ color }}>Open {days} day{days === 1 ? '' : 's'}</p>;
}

// Small colored pill showing which department a ticket belongs to — only
// rendered for tickets.view_all users (dept-scoped users already know
// they're only seeing their own department's tickets).
export function DeptPill({ name, className = 'ml-2' }) {
  if (!name) return null;
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-px text-[11px] font-semibold ${className}`}
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}
    >
      {name}
    </span>
  );
}

export function SortIcon({ active, dir }) {
  if (!active) return null;
  return <span className="ml-1">{dir === 'asc' ? '▲' : '▼'}</span>;
}
