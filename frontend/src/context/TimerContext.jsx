import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { errMessage } from '../api/api';

// A single active timer, persisted to localStorage so it survives navigation and
// page reloads. Starting a timer while another is running logs the previous one
// first. On stop, the elapsed time is posted as a time entry on the ticket/project.
const TimerContext = createContext(null);
const STORAGE_KEY = 'prism.activeTimer';

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function TimerProvider({ children }) {
  const [activeTimer, setActiveTimer] = useState(loadStored); // { type, id, label, startedAt }
  const [now, setNow] = useState(() => Date.now());
  // Increments after each successful log so pages can refresh their time data.
  const [logVersion, setLogVersion] = useState(0);

  useEffect(() => {
    try {
      if (activeTimer) localStorage.setItem(STORAGE_KEY, JSON.stringify(activeTimer));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore storage errors */
    }
  }, [activeTimer]);

  // Tick every second while a timer is running.
  useEffect(() => {
    if (!activeTimer) return undefined;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [activeTimer]);

  const postEntry = async (timer) => {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(timer.startedAt).getTime()) / 1000));
    const minutes = Math.max(1, Math.round(seconds / 60));
    const url = timer.type === 'project' ? `/projects/${timer.id}/time` : `/tickets/${timer.id}/time`;
    await api.post(url, { minutes, note: 'Timer', loggedAt: timer.startedAt });
  };

  const stop = useCallback(async () => {
    if (!activeTimer) return;
    try {
      await postEntry(activeTimer);
      setActiveTimer(null);
      setLogVersion((v) => v + 1);
    } catch (err) {
      // Keep the timer running so no time is lost.
      alert(errMessage(err, 'Failed to log time'));
      throw err;
    }
  }, [activeTimer]);

  const start = useCallback(
    async (type, id, label) => {
      if (activeTimer) {
        if (activeTimer.type === type && Number(activeTimer.id) === Number(id)) return; // already timing this
        try {
          await postEntry(activeTimer); // log the one currently running
          setLogVersion((v) => v + 1);
        } catch (err) {
          alert(errMessage(err, 'Failed to log the running timer'));
          return;
        }
      }
      setActiveTimer({ type, id: Number(id), label, startedAt: new Date().toISOString() });
      setNow(Date.now());
    },
    [activeTimer]
  );

  // Discard the running timer without logging it.
  const cancel = useCallback(() => setActiveTimer(null), []);

  const elapsedSeconds = activeTimer
    ? Math.max(0, Math.floor((now - new Date(activeTimer.startedAt).getTime()) / 1000))
    : 0;

  const isRunning = (type, id) =>
    !!activeTimer && activeTimer.type === type && Number(activeTimer.id) === Number(id);

  const value = { activeTimer, elapsedSeconds, logVersion, start, stop, cancel, isRunning };
  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useTimer() {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error('useTimer must be used within TimerProvider');
  return ctx;
}

// Shared mm:ss formatter for elapsed seconds.
export function formatElapsed(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
