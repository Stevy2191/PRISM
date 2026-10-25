// Keyboard moves through the task list: J next, K previous, Esc closes the
// panel. Ignored while typing and with Ctrl/Alt/Cmd held.
import { useEffect, useRef } from 'react';

// The index after moving `delta` rows from `current` (-1: nothing selected),
// kept inside the list. -1 for an empty list.
export function nextIndex(current, delta, length) {
  if (length <= 0) return -1;
  if (current < 0) return 0;
  return Math.min(length - 1, Math.max(0, current + delta));
}

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function useListKeys({ ids, selectedId, onSelect, onClose }) {
  // The handler reads the latest values without re-binding on every render.
  const latest = useRef();
  latest.current = { ids, selectedId, onSelect, onClose };
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (TYPING.has(t.tagName) || t.isContentEditable)) return;
      const { ids: list, selectedId: sel, onSelect: select, onClose: close } = latest.current;
      if (e.key === 'Escape') {
        if (sel != null) close();
        return;
      }
      const delta = e.key === 'j' || e.key === 'J' ? 1 : e.key === 'k' || e.key === 'K' ? -1 : 0;
      if (!delta) return;
      const i = nextIndex(list.indexOf(sel), delta, list.length);
      if (i >= 0) { e.preventDefault(); select(list[i]); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
