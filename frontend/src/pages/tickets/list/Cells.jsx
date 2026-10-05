// Table and card cells for the ticket list.
import { initials } from '../../../utils/userDisplay';
import { BORDER, TEXT, MUTED } from '../theme';
import { PRIORITY_META, SOURCE_META, todayStr, isClosedStatus, ageDays } from './listHelpers';

export function Avatar({ name }) {
  if (!name) {
    return <span className="text-sm" style={{ color: MUTED }}>Unassigned</span>;
  }
  return (
    <span className="flex items-center gap-2">
      <span
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
        style={{ backgroundColor: BORDER, color: 'var(--color-accent)' }}
      >
        {initials(name)}
      </span>
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
    <span
      className="flex w-fit items-center gap-1 rounded-[3px] px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 13%, transparent)`, color: meta.color }}
    >
      {Icon && <Icon size={11} />}
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
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`, color }}
    >
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {ticket.status}
    </span>
  );
}

export function DueDateCell({ dueDate }) {
  if (!dueDate) return <span className="text-sm" style={{ color: MUTED }}>—</span>;
  const today = todayStr();
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const soonStr = soon.toISOString().slice(0, 10);
  let color = MUTED;
  if (dueDate < today) color = 'var(--color-danger)';
  else if (dueDate <= soonStr) color = 'var(--color-warning)';
  return <span className="text-sm" style={{ color }}>{dueDate}</span>;
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
export function DeptPill({ name }) {
  if (!name) return null;
  return (
    <span
      className="ml-2 inline-flex items-center rounded-[3px] px-2 py-0.5 text-[11px] font-medium"
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
