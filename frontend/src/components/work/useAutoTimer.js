// Automatic timer mode: start the ticket's timer when it opens, unless the
// ticket already has one (the server re-checks with onlyIfNone — never
// replace or resume one silently); timers on other items are left running.
// Leaving the page stops this ticket's timer: below the minimum it asks, with
// "prompt before log" it asks, otherwise it logs. A paused timer is left
// alone. Closing the tab logs (or discards below the minimum) with sendBeacon.
import { useEffect, useRef } from 'react';
import { useTimer } from '../../context/TimerContext';

export default function useAutoTimer({ kind, parentId, label, enabled, user }) {
  const timer = useTimer();
  const ref = useRef(timer);
  useEffect(() => { ref.current = timer; }, [timer]);

  const { loaded } = timer;
  useEffect(() => {
    // Not before the timers are known: "none yet" isn't "none".
    if (!enabled || !parentId || !loaded) return undefined;
    if (!ref.current.timerFor(kind, parentId)) ref.current.start(kind, parentId, { label, onlyIfNone: true });
    const mineRunning = () => {
      const t = ref.current.timerFor(kind, parentId);
      return t && t.state === 'running' ? t : null;
    };
    const belowMin = (t) => ref.current.elapsedOf(t) < (user.timerMinThreshold || 0);

    const onUnload = () => {
      const t = mineRunning();
      if (!t) return;
      // Only this timer: another tab or device may have logged it already.
      const body = belowMin(t) ? { discard: true } : {};
      navigator.sendBeacon(`/api/v1/timer/${t.timerId}/stop`, new Blob([JSON.stringify(body)], { type: 'application/json' }));
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      const t = mineRunning();
      if (!t) return;
      const elapsed = ref.current.elapsedOf(t);
      const fmt = `${Math.floor(elapsed / 60)} min`;
      let keep = true;
      if (belowMin(t)) keep = window.confirm(`This entry is ${fmt}, below your minimum. Log it anyway?`);
      else if (user.timerPromptBeforeLog) keep = window.confirm(`Log ${fmt} of time before leaving?`);
      ref.current.stop(t.timerId, keep ? {} : { discard: true }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, kind, parentId, loaded]);
}
