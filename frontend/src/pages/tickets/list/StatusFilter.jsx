import { useEffect, useRef, useState } from 'react';

// Status filter with several at once (owner, 2026-11-13): tick any statuses,
// or "Not closed" for every status that isn't closed. `value` is a list of
// status names and the aggregates 'not_closed', 'on_hold' and 'closed'.
export function statusLabel(value) {
  if (!value.length) return 'All statuses';
  if (value.length === 1) {
    if (value[0] === 'not_closed') return 'Not closed';
    if (value[0] === 'on_hold') return 'On hold (all)';
    if (value[0] === 'closed') return 'Closed';
    return value[0];
  }
  return value.length === 2 ? value.map((v) => ({ not_closed: 'Not closed', on_hold: 'On hold', closed: 'Closed' }[v] || v)).join(', ') : `${value.length} selected`;
}

export default function StatusFilter({ value, onChange, ticketStatuses, className = '', id = 'status-filter' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  // Picking a status replaces an aggregate ("Not closed" plus "Waiting" means nothing more).
  const toggle = (v) => {
    const plain = value.filter((x) => x !== 'not_closed');
    onChange(plain.includes(v) ? plain.filter((x) => x !== v) : [...plain, v]);
  };
  const statuses = ticketStatuses.filter((s) => s.behaviorType !== 'archived');
  const active = value.length > 0;
  const row = 'flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]';

  return (
    <span ref={ref} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        id={id}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Status: ${statusLabel(value)}`}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-8 flex-shrink-0 items-center gap-1 rounded-md border bg-surface px-3 text-[13px] font-medium text-navy-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent max-sm:h-11 ${active ? '' : 'border-navy-100'}`}
        style={active ? { borderColor: 'var(--color-accent)' } : undefined}
      >
        <span aria-hidden="true">Status:</span>
        <span className="max-w-[12rem] truncate font-semibold text-navy-900">{statusLabel(value)}</span>
        <span aria-hidden="true" className="text-navy-400">▾</span>
      </button>
      {open && (
        <div role="group" aria-label="Statuses" className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-navy-100 bg-surface p-1 shadow-lg" data-testid="status-filter-menu">
          <button type="button" className={row} onClick={() => { onChange([]); setOpen(false); }}>
            <span className="w-4 text-center" aria-hidden="true">{value.length ? '' : '✓'}</span>All statuses
          </button>
          <button type="button" className={row} onClick={() => { onChange(['not_closed']); setOpen(false); }}>
            <span className="w-4 text-center" aria-hidden="true">{value.length === 1 && value[0] === 'not_closed' ? '✓' : ''}</span>Not closed
            <span className="ml-auto text-xs text-navy-400">every open status</span>
          </button>
          <div className="my-1 border-t border-navy-100" />
          {statuses.map((s) => (
            <label key={s.id || s.name} className={row}>
              <input type="checkbox" className="accent-[var(--color-accent)]" checked={value.includes(s.name)} onChange={() => toggle(s.name)} />
              {s.name}
            </label>
          ))}
          <div className="my-1 border-t border-navy-100" />
          <label className={row}>
            <input type="checkbox" className="accent-[var(--color-accent)]" checked={value.includes('on_hold')} onChange={() => toggle('on_hold')} />
            On hold (all)
          </label>
          <label className={row}>
            <input type="checkbox" className="accent-[var(--color-accent)]" checked={value.includes('closed')} onChange={() => toggle('closed')} />
            Closed (all)
          </label>
        </div>
      )}
    </span>
  );
}
