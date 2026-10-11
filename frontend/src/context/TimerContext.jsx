import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { errMessage } from '../api/api';
import { useAuth } from './AuthContext';

// The one timer per user (plan 3c; user decision 2026-10-11), kept on the
// server so it follows the user across devices and tabs. It can run on a
// ticket, a project or one of their tasks, and pauses and resumes. The
// server reports elapsedSeconds; this ticks it locally between syncs.
const TimerContext = createContext(null);

export function TimerProvider({ children }) {
  const { user, hasPermission } = useAuth();
  const canTime = !!user && hasPermission('time.log');
  const [activeTimer, setActiveTimer] = useState(null); // server shape, or null
  const [syncedAt, setSyncedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  // Increments after each successful log so pages can refresh their time data.
  const [logVersion, setLogVersion] = useState(0);

  const apply = useCallback((timer) => { setActiveTimer(timer); setSyncedAt(Date.now()); }, []);

  // The ticket page's old browser-only timer (before plan 3c) is not carried over.
  useEffect(() => {
    try { localStorage.removeItem('prism.ticketTimer.v1'); } catch { /* storage unavailable */ }
  }, []);
  const bumpLogVersion = useCallback(() => setLogVersion((v) => v + 1), []);

  const refresh = useCallback(async () => {
    if (!canTime) {
      apply(null);
      return;
    }
    try {
      const { data } = await api.get('/timer');
      apply(data.timer);
    } catch {
      /* leave current state on transient errors */
    }
  }, [canTime, apply]);

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

  // Tick every second while a timer is running.
  const running = activeTimer?.state === 'running';
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [running, syncedAt]);

  const start = useCallback(async (type, id, { taskId = null, label = null } = {}) => {
    try {
      const { data } = await api.post('/timer/start', { type, id, taskId, label });
      apply(data.timer);
      if (data.logged) bumpLogVersion(); // a previous timer was logged
      return data;
    } catch (err) {
      alert(errMessage(err, 'Failed to start timer'));
      return null;
    }
  }, [apply, bumpLogVersion]);

  const pause = useCallback(async () => {
    const { data } = await api.post('/timer/pause');
    apply(data.timer);
    return data.timer; // the paused timer, with its frozen elapsedSeconds
  }, [apply]);

  const resume = useCallback(async () => {
    const { data } = await api.post('/timer/resume');
    apply(data.timer);
    return data.timer;
  }, [apply]);

  const stop = useCallback(async ({ note, discard } = {}) => {
    const { data } = await api.post('/timer/stop', { ...(note ? { note } : {}), ...(discard ? { discard: true } : {}) });
    apply(null);
    if (data.entry) bumpLogVersion();
    return data;
  }, [apply, bumpLogVersion]);

  // Discard without logging.
  const cancel = useCallback(async () => {
    try {
      await api.delete('/timer');
    } catch {
      /* ignore */
    }
    apply(null);
  }, [apply]);

  const elapsedSeconds = activeTimer
    ? activeTimer.elapsedSeconds + (running ? Math.max(0, Math.floor((now - syncedAt) / 1000)) : 0)
    : 0;

  // taskId undefined: any timer on that ticket or project; otherwise that exact task (null = no task).
  const isRunning = (type, id, taskId) => !!activeTimer && activeTimer.type === type && Number(activeTimer.id) === Number(id)
    && (taskId === undefined || (activeTimer.taskId ?? null) === (taskId ?? null));

  const value = {
    activeTimer, elapsedSeconds, logVersion, start, pause, resume, stop, cancel, isRunning, refresh, bumpLogVersion,
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
