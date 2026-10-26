// What fills one person-day, opened from a cell. Fixed to the viewport next to
// the cell so the grid's own scrolling never clips it.
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { canDrop, hoursLabel, longDay } from './dispatch';

const WIDTH = 330;

// The drag state is set a tick late: restyling the dragged row's own popover
// inside dragstart makes the browser cancel the drag.
export default function CellPopover({ anchor, person, dateKey, cell, items, defaultTicketNote, dragging, onDragStart, onDragEnd, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest('[data-cell]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);
  useEffect(() => { ref.current?.focus(); }, []);

  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8));
  const top = Math.min(anchor.bottom + 6, Math.max(8, window.innerHeight - 360));
  const title = dateKey === 'none' ? 'No date' : longDay(dateKey);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${person.name} on ${title}`}
      tabIndex={-1}
      className="fixed z-50 max-h-[70vh] overflow-y-auto rounded-xl border p-3.5 shadow-lg focus:outline-none"
      style={{ left, top, width: WIDTH, maxWidth: 'calc(100vw - 16px)', backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)', pointerEvents: dragging ? 'none' : undefined, opacity: dragging ? 0.35 : 1 }}
    >
      <div className="mb-2 flex justify-between gap-3 font-semibold text-navy-900">
        <span>{person.name.split(' ')[0]} · {title}</span>
        {dateKey !== 'none' && <span className="num">{hoursLabel(cell.minutes)} of {hoursLabel(cell.capacity)}</span>}
      </div>
      {items.map((item) => {
        const days = Object.keys(item.byDay).length;
        const href = item.kind === 'ticket' ? `/tickets/${item.id}` : `/projects/${item.projectId}`;
        return (
          <div
            key={`${item.kind}:${item.id}`}
            draggable={canDrop(item)}
            data-item-kind={item.kind}
            data-item-id={item.id}
            data-draggable={canDrop(item) ? 'true' : 'false'}
            onDragStart={canDrop(item) ? (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', `${item.kind}:${item.id}`); setTimeout(() => onDragStart(item), 0); } : undefined}
            onDragEnd={canDrop(item) ? onDragEnd : undefined}
            className={`grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t py-2 text-[13px] ${canDrop(item) ? 'cursor-grab' : ''}`} style={{ borderColor: 'var(--color-border)' }}>
            <span className="min-w-0">
              <Link to={href} className="font-medium text-navy-900 hover:underline">{item.title}</Link>
              <span className="block text-[12px] text-navy-400">
                <span className="num">{item.code}</span>
                {days > 1 ? ` · ${hoursLabel(item.minutes)} over ${days} days` : ''}
                {item.overdue ? ' · overdue' : ''}
              </span>
            </span>
            <span className="num text-navy-500">{hoursLabel(item.byDay[dateKey])}</span>
          </div>
        );
      })}
      {!items.length && <p className="text-sm text-navy-400">Nothing in this day.</p>}
      {defaultTicketNote}
    </div>
  );
}
