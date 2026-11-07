// A line's toolbar (PB2): Required, Only for…, Turn into, indent, move, delete.
import { useEffect, useRef, useState } from 'react';
import {
  IconArrowUp, IconArrowDown, IconTrash, IconIndentIncrease, IconIndentDecrease, IconChevronDown,
} from '@tabler/icons-react';

// What a line can be turned into, in the screens' words.
export const TURN_INTO = [
  { label: 'Step', kind: 'step' },
  { label: 'Yes/no question', kind: 'field', fieldType: 'yesno' },
  { label: 'Pick one', kind: 'field', fieldType: 'choice' },
  { label: 'Write down', kind: 'field', fieldType: 'text' },
  { label: 'Write down: longer text', kind: 'field', fieldType: 'longtext' },
  { label: 'Write down: a number', kind: 'field', fieldType: 'number' },
  { label: 'Write down: a date', kind: 'field', fieldType: 'date' },
  { label: 'Write down: a staff member', kind: 'field', fieldType: 'staff' },
  { label: 'Write down: a contact', kind: 'field', fieldType: 'contact' },
  { label: 'Password / code (hidden)', kind: 'secure' },
  { label: 'Note', kind: 'text' },
  { label: 'Ticks itself when the PRISM agent reports in', kind: 'agent', deviceOnly: true },
];

const btn = 'inline-flex h-8 items-center gap-1 rounded-md border border-navy-200 bg-surface px-2 text-xs font-medium text-navy-600 hover:bg-navy-50 disabled:opacity-40 max-sm:min-h-[40px]';

function TurnIntoMenu({ usage, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" className={btn} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Turn into <IconChevronDown size={12} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-64 rounded-md border border-navy-100 bg-surface py-1 shadow-lg"
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
          {TURN_INTO.filter((t) => !t.deviceOnly || usage === 'device').map((t) => (
            <button key={t.label} type="button" role="menuitem" className="block w-full px-3 py-2 text-left text-sm hover:bg-navy-50"
              onClick={() => { setOpen(false); onPick(t); }}>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LineToolbar({
  line, usage, canIndent, onRequired, onOnlyFor, onTurnInto, onIndent, onOutdent, onUp, onDown, onDelete,
}) {
  const { item } = line;
  const canRequire = item.kind !== 'text';
  return (
    <div role="toolbar" aria-label="Line options" className="flex flex-wrap items-center gap-1">
      {canRequire && (
        <button type="button" className={`${btn} ${item.required ? 'border-prism-accent text-navy-900' : ''}`} aria-pressed={!!item.required} onClick={onRequired}>
          {item.required ? 'Required' : 'Optional'}
        </button>
      )}
      {usage === 'device' && !line.advanced && <button type="button" className={btn} onClick={onOnlyFor}>Only for…</button>}
      <TurnIntoMenu usage={usage} onPick={onTurnInto} />
      {!line.advanced && (line.indent
        ? <button type="button" className={btn} aria-label="Take out from under the question" title="Shift+Tab" onClick={onOutdent}><IconIndentDecrease size={14} /></button>
        : <button type="button" className={btn} aria-label="Put under the question above" title="Tab" disabled={!canIndent} onClick={onIndent}><IconIndentIncrease size={14} /></button>)}
      <button type="button" className={btn} aria-label="Move up" title="Alt+↑" onClick={onUp}><IconArrowUp size={14} /></button>
      <button type="button" className={btn} aria-label="Move down" title="Alt+↓" onClick={onDown}><IconArrowDown size={14} /></button>
      <button type="button" className={btn} aria-label="Delete line" onClick={onDelete}><IconTrash size={14} /></button>
    </div>
  );
}
