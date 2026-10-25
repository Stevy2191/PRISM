// Pointer-event drag for timeline bars. begin() on pointer down; the hook
// follows the pointer on window, snaps to whole days, and calls onCommit with
// the day delta on release. Esc cancels. A press that never travels a day is
// a click and commits nothing.
import { useCallback, useEffect, useRef, useState } from 'react';

export function useBarDrag({ enabled, zoomPx, onCommit }) {
  const [drag, setDrag] = useState(null); // { taskId, mode, delta }
  const live = useRef(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  const begin = useCallback((e, task, mode) => {
    if (!enabled || e.button > 0) return;
    e.preventDefault();
    live.current = { task, mode, startX: e.clientX, delta: 0 };
    setDrag({ taskId: task.id, mode, delta: 0 });
  }, [enabled]);

  const active = drag !== null;
  useEffect(() => {
    if (!active) return undefined;
    const move = (e) => {
      const cur = live.current;
      if (!cur) return;
      cur.delta = Math.round((e.clientX - cur.startX) / zoomPx);
      setDrag((d) => (d && d.delta !== cur.delta ? { ...d, delta: cur.delta } : d));
    };
    const stop = () => { live.current = null; setDrag(null); };
    const up = () => {
      const cur = live.current;
      stop();
      if (cur && cur.delta !== 0) commit.current(cur.task, cur.mode, cur.delta);
    };
    const key = (e) => { if (e.key === 'Escape') stop(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('keydown', key);
    };
  }, [active, zoomPx]);

  return { drag, begin };
}
