// The ticket list's saved filters menu.
import { IconBookmark, IconChevronDown } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { BORDER, TEXT, MUTED, BLUE } from '../theme';

// ---- Toolbar sub-menus ----

export function SavedFiltersMenu({
  align = 'right', savedFilters, activeId, onApply, onSave, onDelete,
}) {
  const [open, setOpen] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef(null);
  useClickOutside(ref, () => { setOpen(false); setShowSave(false); });

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Saved filters"
        aria-expanded={open}
        className="inline-flex h-10 items-center gap-2 rounded-md border border-navy-100 bg-surface px-3 text-[13px] font-semibold text-navy-900 hover:bg-[var(--color-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent lg:h-8"
      >
        <IconBookmark size={15} aria-hidden="true" />
        Saved filters
        <IconChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} z-20 mt-1 w-64 rounded-lg border border-navy-100 bg-surface p-1 shadow-lg`}
        >
          {savedFilters.length === 0 && (
            <p className="px-3 py-2 text-xs" style={{ color: MUTED }}>No saved filters yet.</p>
          )}
          {savedFilters.map((f) => (
            <div key={f.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { onApply(f); setOpen(false); }}
                className="flex flex-1 items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-[var(--color-hover)]"
                style={{ color: TEXT }}
              >
                <span className="truncate">{f.name}</span>
                {activeId === f.id && <span style={{ color: BLUE }}>✓</span>}
              </button>
              <button
                type="button"
                onClick={() => onDelete(f)}
                title="Delete saved filter"
                className="px-2 text-xs"
                style={{ color: MUTED }}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="mt-1 border-t pt-1" style={{ borderColor: BORDER }}>
            {showSave ? (
              <div className="flex items-center gap-1 px-2 py-1">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Filter name"
                  className="input h-8 flex-1 text-sm"
                  style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim()) { onSave(name.trim()); setName(''); setShowSave(false); }
                  }}
                />
                <button
                  type="button"
                  onClick={() => { if (name.trim()) { onSave(name.trim()); setName(''); setShowSave(false); } }}
                  className="rounded px-2 py-1 text-xs font-medium"
                  style={{ backgroundColor: BLUE, color: 'white' }}
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowSave(true)}
                className="w-full rounded px-3 py-2 text-left text-sm hover:bg-[var(--color-hover)]"
                style={{ color: BLUE }}
              >
                + Save current filter
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
