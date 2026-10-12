import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { errMessage } from '../api/api';
import { useAuth } from './AuthContext';

// The user's timers (user decision 2026-10-12), kept on the server so they
// follow the user across devices and tabs: one per ticket or project,
// optionally on one of its tasks. Timers on different items count at the same
// time; each pauses, resumes and stops on its own. A timer stops counting at
// the longest-entry limit. The server reports elapsedSeconds; this ticks them
// locally between syncs.
const TimerContext = createContext(null);

export function TimerProvider({ children }) {
  const { user, hasPermission } = useAuth();
  const canTime = !!user && hasPermission('time.log');
  const [timers, setTimers] = useState([]); // server shapes, newest first
  // False until the first GET /timer answers: before that, "no timer" only
  // means "not known yet" (automatic mode must not act on it).
  const [loaded, setLoaded] = useState(false);
  const [syncedAt, setSyncedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  // Increments after each successful log so pages can refresh their time data.
  const [logVersion, setLogVersion] = useState(0);
  const bumpLogVersion = useCallback(() => setLogVersion((v) => v + 1), []);

  // The ticket page's old browser-only timer (before plan 3c) is not carried over.
  useEffect(() => {
    try { localStorage.removeItem('prism.ticketTimer.v1'); } catch { /* storage unavailable */ }
  }, []);

  const refresh = useCallback(async () => {
    if (!canTime) {
      setTimers([]);
      setLoaded(false);
      return;
    }
    try {
      const { data } = await api.get('/timer');
      setSyncedAt(Date.now());
      setTimers(data.timers);
      setLoaded(true);
    } catch {
      /* leave current state on transient errors */
    }
  }, [canTime]);

  // Load on login / permission change.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Keep in sync across devices: re-check when the tab regains focus.
  useEffect(() => {
    if (!canTime) return undefined;
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [canTime, refresh]);

  // Tick every second while any timer is running.
  const anyRunning = timers.some((t) => t.state === 'running');
  useEffect(() => {
    if (!anyRunning) return undefined;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [anyRunning, syncedAt]);

  // A timer's elapsed seconds right now, up to its limit. A running timer that
  // reaches the limit shows as stopped there; the server pauses it.
  const elapsedOf = useCallback((t) => {
    if (!t) return 0;
    const extra = t.state === 'running' ? Math.max(0, Math.floor((now - syncedAt) / 1000)) : 0;
    return Math.min(t.limitSeconds || Infinity, t.elapsedSeconds + extra);
  }, [now, syncedAt]);
  const atLimit = useCallback((t) => !!t && (t.atLimit || elapsedOf(t) >= (t.limitSeconds || Infinity)), [elapsedOf]);

  // Folds one timer from the server into the list (each live value re-based).
  const put = useCallback((timer) => {
    const at = Date.now();
    const gone = Math.max(0, Math.floor((at - syncedAt) / 1000));
    setTimers((list) => {
      const others = list
        .filter((t) => t.timerId !== timer.timerId && !(t.type === timer.type && Number(t.id) === Number(timer.id)))
        .map((t) => (t.state === 'running' ? { ...t, elapsedSeconds: Math.min(t.limitSeconds, t.elapsedSeconds + gone) } : t));
      return [timer, ...others];
    });
    setSyncedAt(at);
  }, [syncedAt]);
  const drop = useCallback((timerId) => setTimers((list) => list.filter((t) => t.timerId !== timerId)), []);

  // A failed timer call (say, the timer was stopped on another device) shows
  // why and re-syncs with the server instead of leaving a stale control.
  const failed = useCallback((err) => {
    alert(errMessage(err, 'The timer could not be updated'));
    refresh();
    return null;
  }, [refresh]);

  // onlyIfNone: start only if this item has no timer (automatic mode).
  const start = useCallback(async (type, id, { taskId = null, label = null, onlyIfNone = false } = {}) => {
    try {
      const { data } = await api.post('/timer/start', { type, id, taskId, label, ...(onlyIfNone ? { onlyIfNone: true } : {}) });
      put(data.timer);
      if (data.logged) bumpLogVersion(); // the item's timer on another task was logged
      // Ask once, on a click, for desktop reminders (the browser wants a gesture).
      if (!onlyIfNone && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      return data;
    } catch (err) {
      alert(errMessage(err, 'Failed to start timer'));
      return null;
    }
  }, [put, bumpLogVersion]);

  const pause = useCallback(async (timerId) => {
    try {
      const { data } = await api.post(`/timer/${timerId}/pause`);
      put(data.timer);
      return data.timer; // the paused timer, with its frozen elapsedSeconds
    } catch (err) { return failed(err); }
  }, [put, failed]);

  const resume = useCallback(async (timerId) => {
    try {
      const { data } = await api.post(`/timer/${timerId}/resume`);
      put(data.timer);
      return data.timer;
    } catch (err) { return failed(err); }
  }, [put, failed]);

  // Logs and clears one timer. entry: the Log time form's fields; discard:
  // clear without logging. Throws on failure (a 409 when it was already
  // logged elsewhere) — callers show why; the list re-syncs.
  const stop = useCallback(async (timerId, { note, discard, entry } = {}) => {
    try {
      const { data } = await api.post(`/timer/${timerId}/stop`, {
        ...(note ? { note } : {}), ...(discard ? { discard: true } : {}), ...(entry ? { entry } : {}),
      });
      drop(timerId);
      if (data.entry) bumpLogVersion();
      return data;
    } catch (err) {
      refresh();
      throw err;
    }
  }, [drop, bumpLogVersion, refresh]);

  // The timer on a ticket or project (any task), or null.
  const timerFor = useCallback((type, id) => timers.find((t) => t.type === type && Number(t.id) === Number(id)) || null, [timers]);

  const value = {
    timers, loaded, logVersion, start, pause, resume, stop, refresh, bumpLogVersion, timerFor, elapsedOf, atLimit,
  };
  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useTimer() {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error('useTimer must be used within TimerProvider');
  return ctx;
}

// Shared mm:ss (or h:mm:ss) formatter for elapsed seconds.
export function formatElapsed(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Always-HH:MM:SS formatter for timer displays.
export function formatHMS(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

// Where a timer's ticket or project is.
export const timerPath = (t) => (t.type === 'ticket' ? `/tickets/${t.id}` : `/projects/${t.id}`);
