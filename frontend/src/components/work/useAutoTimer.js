// Automatic timer mode: start the server timer when a ticket opens (only when
// no timer exists anywhere, which the server re-checks with onlyIfIdle —
// never replace or resume one silently), and stop it when
// the page is left: below the minimum it asks, with "prompt before log" it
// asks, otherwise it logs. A paused timer is left alone. Closing the tab logs
// (or discards below the minimum) with sendBeacon.
import { useEffect, useRef } from 'react';
import { useTimer } from '../../context/TimerContext';

export default function useAutoTimer({ kind, parentId, label, enabled, user }) {
  const timer = useTimer();
  const ref = useRef(timer);
  useEffect(() => { ref.current = timer; }, [timer]);

  const { loaded } = timer;
  useEffect(() => {
    // Not before the current timer is known: "none yet" isn't "none".
    if (!enabled || !parentId || !loaded) return undefined;
    if (!ref.current.activeTimer) ref.current.start(kind, parentId, { label, onlyIfIdle: true });
    const mineRunning = () => {
      const t = ref.current.activeTimer;
      return t && t.type === kind && Number(t.id) === Number(parentId) && t.state === 'running' ? ref.current : null;
    };
    const belowMin = (t) => t.elapsedSeconds < (user.timerMinThreshold || 0);

    const onUnload = () => {
      const t = mineRunning();
      if (!t) return;
      // Only this timer: another tab or device may have replaced it.
      const body = { expectTimerId: t.activeTimer.timerId, ...(belowMin(t) ? { discard: true } : {}) };
      navigator.sendBeacon('/api/v1/timer/stop', new Blob([JSON.stringify(body)], { type: 'application/json' }));
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      const t = mineRunning();
      if (!t) return;
      const elapsed = t.elapsedSeconds;
      const fmt = `${Math.floor(elapsed / 60)} min`;
      let keep = true;
      if (belowMin(t)) keep = window.confirm(`This entry is ${fmt}, below your minimum. Log it anyway?`);
      else if (user.timerPromptBeforeLog) keep = window.confirm(`Log ${fmt} of time before leaving?`);
      t.stop({ expectTimerId: t.activeTimer.timerId, ...(keep ? {} : { discard: true }) }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, kind, parentId, loaded]);
}
