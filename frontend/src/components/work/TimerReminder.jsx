// "Still working on these?" (user decision 2026-10-12): a popup for timers
// left running, first after the user's timerReminderMinutes of counting, then
// every timerReminderRepeatMinutes (Preferences; 0 turns them off). Also a
// desktop notification when the browser allows one. Only while a PRISM tab is
// open; the longest-entry limit covers a closed browser. Open tabs share which
// reminders were shown (localStorage), so one reminder pops up, not one each.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../Modal';
import TimeEntryForm from './TimeEntryForm';
import { useTimer, formatHMS, timerPath } from '../../context/TimerContext';
import { useAuth } from '../../context/AuthContext';

const PREFIX = 'prism.timerReminder.';
const CHECK_MS = 30 * 1000;
const nameOf = (t) => t.label || (t.type === 'ticket' ? 'Ticket' : 'Project');

// Which reminder a timer is due: -1 before the first, then 0, 1, 2, …
export function reminderNumber(elapsedSeconds, firstMinutes, repeatMinutes) {
  const minutes = elapsedSeconds / 60;
  if (!firstMinutes || minutes < firstMinutes) return -1;
  return Math.floor((minutes - firstMinutes) / Math.max(15, repeatMinutes || 60));
}

function readShown(id, memory) {
  try {
    const v = localStorage.getItem(PREFIX + id);
    if (v !== null) return Number(v);
  } catch { /* storage unavailable: this tab's memory only */ }
  return memory.get(id) ?? -1;
}

function writeShown(id, n, memory) {
  memory.set(id, n);
  try { localStorage.setItem(PREFIX + id, String(n)); } catch { /* storage unavailable */ }
}

const describe = (minutes) => (minutes % 60 ? `${minutes} minutes` : `${minutes / 60} hour${minutes === 60 ? '' : 's'}`);

export default function TimerReminder() {
  const ctx = useTimer();
  const { user, canLogTimeForOthers } = useAuth();
  const [ids, setIds] = useState([]); // timers in the popup
  const [stopped, setStopped] = useState(null);
  const memory = useRef(new Map());
  const ref = useRef(ctx);
  useEffect(() => { ref.current = ctx; }, [ctx]);

  const first = user?.timerReminderMinutes ?? 120;
  const repeat = user?.timerReminderRepeatMinutes ?? 60;

  useEffect(() => {
    if (!first || !ctx.loaded) return undefined;
    const check = () => {
      const { timers, elapsedOf, atLimit } = ref.current;
      // Forget reminders for timers that are gone.
      try {
        const live = new Set(timers.map((t) => String(t.timerId)));
        Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) && !live.has(k.slice(PREFIX.length)))
          .forEach((k) => localStorage.removeItem(k));
      } catch { /* storage unavailable */ }
      const due = timers.filter((t) => t.state === 'running' && !atLimit(t)
        && reminderNumber(elapsedOf(t), first, repeat) > readShown(t.timerId, memory.current));
      if (!due.length) return;
      due.forEach((t) => writeShown(t.timerId, reminderNumber(elapsedOf(t), first, repeat), memory.current));
      setIds((cur) => [...new Set([...cur, ...due.map((t) => t.timerId)])]);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          // No ticket titles: a desktop notification can show on a lock screen.
          const n = new Notification('PRISM: still working?', {
            body: `${due.length} timer${due.length === 1 ? ' has' : 's have'} been running a while. Open PRISM to keep going, pause or stop.`,
            tag: 'prism-timer-reminder',
          });
          n.onclick = () => { window.focus(); n.close(); };
        } catch { /* some browsers only notify from a service worker */ }
      }
    };
    check();
    const iv = setInterval(check, CHECK_MS);
    return () => clearInterval(iv);
  }, [first, repeat, ctx.loaded]);

  // Only timers that still exist and still run.
  const shown = ids.map((id) => ctx.timers.find((t) => t.timerId === id)).filter((t) => t && t.state === 'running');
  const done = (id) => setIds((cur) => cur.filter((x) => x !== id));

  const stop = async (t) => {
    const paused = await ctx.pause(t.timerId);
    done(t.timerId);
    if (paused) setStopped({ ...paused, resumeAfter: true });
  };

  return (
    <>
      {shown.length > 0 && !stopped && (
        <Modal title="Still working on these?" onClose={() => setIds([])}>
          <ul className="mb-4 divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {shown.map((t) => (
              <li key={t.timerId} className="py-3">
                <Link to={timerPath(t)} onClick={() => setIds([])} className="block truncate text-sm font-medium hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                  {nameOf(t)}
                </Link>
                <p className="mb-2 font-mono text-xs font-semibold" style={{ color: 'var(--color-timer)' }}>{formatHMS(ctx.elapsedOf(t))} running</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary" onClick={() => done(t.timerId)}>Keep going</button>
                  <button type="button" className="btn-secondary" onClick={async () => { await ctx.pause(t.timerId); done(t.timerId); }}>Pause</button>
                  <button type="button" className="btn-primary" onClick={() => stop(t)}>Stop and log</button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            You&apos;re reminded after {describe(first)} of timing, then every {describe(repeat)}. Change this in Preferences.
          </p>
        </Modal>
      )}
      {stopped && (
        <TimeEntryForm
          kind={stopped.type}
          parentId={stopped.id}
          timer={stopped}
          canManageOthers={canLogTimeForOthers}
          currentUser={user}
          onClose={() => setStopped(null)}
        />
      )}
    </>
  );
}
