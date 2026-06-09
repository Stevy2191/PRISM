import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { errMessage } from '../api/api';
import { useAuth } from './AuthContext';

// Server-backed single active timer per user, so a running timer resumes on any
// device. Stopping or switching converts elapsed time into a TimeEntry server-side.
const TimerContext = createContext(null);

export function TimerProvider({ children }) {
  const { user, isStaff } = useAuth();
  const [activeTimer, setActiveTimer] = useState(null); // { type, id, label, startedAt }
  const [now, setNow] = useState(() => Date.now());
  // Increments after each successful log so pages can refresh their time data.
  const [logVersion, setLogVersion] = useState(0);

  const refresh = useCallback(async () => {
    if (!user || !isStaff) {
      setActiveTimer(null);
      return;
    }
    try {
      const { data } = await api.get('/timer');
      setActiveTimer(data.timer);
    } catch {
      /* leave current state on transient errors */
    }
  }, [user, isStaff]);

  // Load on login / role change.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Keep roughly in sync across devices: re-check when the tab regains focus.
  useEffect(() => {
    if (!user || !isStaff) return undefined;
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [user, isStaff, refresh]);

  // Tick every second while a timer is running.
  useEffect(() => {
    if (!activeTimer) return undefined;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [activeTimer]);

  const start = useCallback(async (type, id, label) => {
    try {
      const { data } = await api.post('/timer/start', { type, id, label });
      setActiveTimer(data.timer);
      if (data.logged) setLogVersion((v) => v + 1); // a previous timer was logged
    } catch (err) {
      alert(errMessage(err, 'Failed to start timer'));
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await api.post('/timer/stop');
      setActiveTimer(null);
      setLogVersion((v) => v + 1);
    } catch (err) {
      alert(errMessage(err, 'Failed to stop timer'));
    }
  }, []);

  // Discard without logging.
  const cancel = useCallback(async () => {
    try {
      await api.delete('/timer');
    } catch {
      /* ignore */
    }
    setActiveTimer(null);
  }, []);

  const elapsedSeconds = activeTimer
    ? Math.max(0, Math.floor((now - new Date(activeTimer.startedAt).getTime()) / 1000))
    : 0;

  const isRunning = (type, id) =>
    !!activeTimer && activeTimer.type === type && Number(activeTimer.id) === Number(id);

  const value = { activeTimer, elapsedSeconds, logVersion, start, stop, cancel, isRunning, refresh };
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
