import { useState } from 'react';

// Simple collapsible section with a clickable header. Used for permission
// category groups and any other "click to expand" block — no accordion
// component existed in the app before this.
//
// Animates via a grid-template-rows 0fr/1fr transition rather than a hard
// conditional render — this is the standard CSS-only way to animate to/from
// an unknown ("auto") height without JS measuring the content first.
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
        <span
          className="text-navy-400 transition-transform duration-200"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          ▾
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-navy-100 p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
