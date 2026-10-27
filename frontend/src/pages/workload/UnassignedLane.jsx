// The "Not assigned yet" lane: work nobody carries, to drag onto a person and
// a day. Items the viewer can't edit are listed but not draggable.
import { useState } from 'react';
import Pill from '../../components/ui/Pill';
import { canDrop, hoursLabel, longDay } from './dispatch';

const KIND_STYLE = {
  ticket: { backgroundColor: 'var(--color-hover)', color: 'var(--color-text-secondary)' },
  task: { backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent)' },
};

function dueText(item) {
  const due = item.kind === 'ticket' ? (item.plannedDate || item.dueDate) : item.dueDate;
  if (!due) return null;
  if (item.kind === 'task' && item.startDate && item.startDate !== due) return `${longDay(item.startDate)} – ${longDay(due)}`;
  return `${item.kind === 'ticket' && !item.plannedDate ? 'Due' : ''} ${longDay(due)}`.trim();
}

export function ItemCard({
  item, dragging, onDragStart, onDragEnd, onAssign,
}) {
  const draggable = canDrop(item);
  const due = dueText(item);
  return (
    <div
      draggable={draggable}
      data-item-kind={item.kind}
      data-item-id={item.id}
      data-draggable={draggable ? 'true' : 'false'}
      onDragStart={draggable ? (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', `${item.kind}:${item.id}`); onDragStart?.(item); } : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      className={`flex flex-col gap-1 rounded-lg border px-3 py-2.5 ${draggable ? 'cursor-grab' : 'cursor-default'} ${dragging ? 'border-dashed opacity-40' : ''}`}
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}
    >
      <div className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--color-text-muted)' }}>
        <span className="rounded px-1.5 text-[11.5px] font-semibold" style={KIND_STYLE[item.kind]}>{item.kind === 'ticket' ? 'Ticket' : 'Task'}</span>
        <span className="num">{item.code}</span>
        {due && (
          <span className="ml-auto" style={item.overdue ? { color: 'var(--color-danger)', fontWeight: 600 } : undefined}>{due}</span>
        )}
      </div>
      <div className="font-semibold text-navy-900">{item.title}</div>
      <div className="flex flex-wrap gap-x-2.5 text-[12.5px] text-navy-500">
        {item.company && <span>{item.company}</span>}
        {item.kind === 'task' && item.projectName && <span>{item.projectName}</span>}
        <span className="num">{hoursLabel(item.minutes)}</span>
      </div>
      {item.assigneeUnavailable && (
        <div className="text-[12.5px]" style={{ color: 'var(--color-waiting)' }}>
          {item.assigneeName ? `Was ${item.assigneeName}` : 'Was assigned'} — not available
        </div>
      )}
      {!draggable && <div className="text-[12px] text-navy-400">You can't change this one</div>}
      {draggable && onAssign && (
        <button
          type="button"
          onClick={() => onAssign(item)}
          aria-label={`Assign ${item.title}`}
          className="mt-0.5 self-start rounded-md px-1.5 py-1 text-[12.5px] font-semibold hover:bg-[var(--color-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent max-lg:min-h-[44px]"
          style={{ color: 'var(--color-accent)' }}
        >
          Assign…
        </button>
      )}
    </div>
  );
}

const FILTERS = [['all', 'All'], ['ticket', 'Tickets'], ['task', 'Tasks']];

export default function UnassignedLane({
  items, dragging, onDragStart, onDragEnd, onAssign,
}) {
  const [filter, setFilter] = useState('all');
  const shown = items.filter((i) => filter === 'all' || i.kind === filter);
  return (
    <aside className="card flex w-full flex-col gap-2.5 p-3.5 lg:max-w-[300px] lg:flex-none" aria-label="Not assigned yet">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-navy-900">Not assigned yet</h3>
        <span className="num text-sm text-navy-400" aria-label={`${items.length} items`}>{items.length}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(([id, label]) => <Pill key={id} on={filter === id} onClick={() => setFilter(id)}>{label}</Pill>)}
      </div>
      <div className="flex max-h-[70vh] flex-col gap-2.5 overflow-y-auto">
        {shown.map((item) => (
          <ItemCard
            key={`${item.kind}:${item.id}`}
            item={item}
            dragging={dragging && dragging.kind === item.kind && dragging.id === item.id}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onAssign={onAssign}
          />
        ))}
        {!shown.length && <p className="text-sm text-navy-400">Nothing waiting. Everything has someone on it.</p>}
      </div>
    </aside>
  );
}
