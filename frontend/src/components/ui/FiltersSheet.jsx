import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Phone bottom sheet for a page's filters (hidden from lg up). Esc and the
// overlay close it; Tab stays inside while it is open; focus goes back to
// whatever opened it.
export default function FiltersSheet({
  open, onClose, title = 'Filters', children,
}) {
  const sheet = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const items = () => [...sheet.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    (items()[0] || sheet.current).focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0];
      const last = list[list.length - 1];
      if (!sheet.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); } else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-navy-100 bg-surface p-4 pb-6 shadow-lg focus:outline-none"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-navy-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent"
            style={{ color: 'var(--color-accent)' }}
          >
            Done
          </button>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
}
