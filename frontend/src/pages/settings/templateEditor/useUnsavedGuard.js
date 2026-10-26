// Warns before leaving the editor with unsaved changes: closing the tab, and
// clicking any link in the app (the app uses a plain router, so a blocker is
// not available; a capture-phase click check covers the menu and links alike).
import { useEffect, useRef } from 'react';

export const LEAVE_MESSAGE = 'You have unsaved changes. Leave without saving?';

export default function useUnsavedGuard(dirty) {
  const ref = useRef(dirty);
  ref.current = dirty;
  useEffect(() => {
    const beforeUnload = (e) => { if (ref.current) { e.preventDefault(); e.returnValue = ''; } };
    const click = (e) => {
      if (!ref.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = e.target.closest?.('a[href]');
      if (!a || a.target === '_blank') return;
      if (!window.confirm(LEAVE_MESSAGE)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', click, true); };
  }, []);
}
