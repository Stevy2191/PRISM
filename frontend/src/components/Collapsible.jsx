import { useState } from 'react';

// Simple collapsible section with a clickable header. Used for permission
// category groups and any other "click to expand" block — no accordion
// component existed in the app before this.
export default function Collapsible({ title, subtitle, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-navy-50"
      >
        <div>
          <p className="font-semibold text-navy-900">{title}</p>
          {subtitle && <p className="text-xs text-navy-500">{subtitle}</p>}
        </div>
        <span className="text-navy-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="border-t border-navy-100 p-4">{children}</div>}
    </div>
  );
}
