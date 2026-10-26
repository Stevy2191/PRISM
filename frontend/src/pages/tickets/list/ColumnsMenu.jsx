// The ticket list's column chooser.
import { IconLayoutColumns } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { FIXED_COLUMNS, DEFAULT_COLUMN_ORDER, COLUMN_LABELS } from './listHelpers';
import { BORDER, TEXT, MUTED } from '../theme';

export function ColumnsMenu({ order, visible, customFields, onChange }) {
  const [open, setOpen] = useState(false);
  const dragIndex = useRef(null);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false));

  const toggle = (key) => {
    if (FIXED_COLUMNS.includes(key)) return;
    onChange({ order, visible: { ...visible, [key]: !visible[key] } });
  };

  const onDrop = (index) => {
    if (dragIndex.current === null || dragIndex.current === index) return;
    const next = [...order];
    const [moved] = next.splice(dragIndex.current, 1);
    next.splice(index, 0, moved);
    dragIndex.current = null;
    onChange({ order: next, visible });
  };

  const reset = () => onChange({ order: DEFAULT_COLUMN_ORDER, visible: Object.fromEntries(DEFAULT_COLUMN_ORDER.map((k) => [k, true])) });

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Columns"
        aria-expanded={open}
        className="inline-flex h-10 items-center gap-2 rounded-md border border-navy-100 bg-surface px-3 text-[13px] font-semibold text-navy-900 hover:bg-[var(--color-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent lg:h-8"
      >
        <IconLayoutColumns size={15} aria-hidden="true" />
        Columns
      </button>
      {open && (
        <div
          className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-navy-100 bg-surface p-1 shadow-lg"
        >
          {FIXED_COLUMNS.map((key) => (
            <div key={key} className="flex items-center gap-2 px-3 py-1.5 text-sm" style={{ color: MUTED }}>
              <input type="checkbox" checked disabled className="accent-[var(--color-accent)]" />
              <span className="flex-1">{COLUMN_LABELS[key]}</span>
              <span title="Always visible">🔒</span>
            </div>
          ))}
          {order.map((key, index) => (
            <div
              key={key}
              draggable
              onDragStart={() => { dragIndex.current = index; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(index)}
              onClick={() => toggle(key)}
              className="flex cursor-pointer items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-[var(--color-hover)]"
              style={{ color: TEXT }}
            >
              <span className="cursor-grab text-xs" style={{ color: MUTED }}>⠿</span>
              <input
                type="checkbox"
                checked={!!visible[key]}
                onChange={() => toggle(key)}
                onClick={(e) => e.stopPropagation()}
                className="accent-[var(--color-accent)]"
              />
              <span className="flex-1">{COLUMN_LABELS[key]}</span>
            </div>
          ))}
          {customFields.length > 0 && (
            <>
              <p className="mt-1 border-t px-3 pb-1 pt-2 text-xs font-semibold" style={{ borderColor: BORDER, color: MUTED }}>
                Custom fields
              </p>
              {customFields.map((f) => {
                const key = `cf:${f.fieldKey}`;
                return (
                  <div
                    key={key}
                    onClick={() => toggle(key)}
                    className="flex cursor-pointer items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-[var(--color-hover)]"
                    style={{ color: TEXT }}
                  >
                    <input
                      type="checkbox"
                      checked={!!visible[key]}
                      onChange={() => toggle(key)}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-[var(--color-accent)]"
                    />
                    <span className="flex-1">{f.label}</span>
                  </div>
                );
              })}
            </>
          )}
          <div className="mt-1 border-t pt-1" style={{ borderColor: BORDER }}>
            <button
              type="button"
              onClick={reset}
              className="w-full rounded px-3 py-2 text-left text-sm hover:bg-[var(--color-hover)]"
              style={{ color: MUTED }}
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
