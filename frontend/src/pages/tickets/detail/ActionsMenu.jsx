// The ticket header's "⋯" menu on a phone: the header actions that don't fit.
// items: [{ label, icon?, onSelect }]. Esc or a click outside closes it and
// focus goes back to the button.
import { useEffect, useRef, useState } from 'react';
import { IconDots } from '@tabler/icons-react';
import { useClickOutside } from '../../../hooks/useClickOutside';

export function ActionsMenu({ items, className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const button = useRef(null);
  const menu = useRef(null);
  useClickOutside(ref, () => setOpen(false));

  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector('[role="menuitem"]')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); button.current?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const list = [...menu.current.querySelectorAll('[role="menuitem"]')];
      const i = list.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!items.length) return null;
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={button}
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center rounded-md text-navy-700 hover:bg-[var(--color-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent"
      >
        <IconDots size={20} aria-hidden="true" />
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="More actions" className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-navy-100 bg-surface p-1 shadow-lg">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); item.onSelect(); }}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-md px-3 text-left text-sm font-medium text-navy-900 hover:bg-[var(--color-hover)] focus:bg-[var(--color-hover)] focus:outline-none"
              >
                {Icon && <Icon size={16} aria-hidden="true" className="text-navy-500" />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
