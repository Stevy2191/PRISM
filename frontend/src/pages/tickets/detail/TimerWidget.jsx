// The ticket timer: persisted state, the header widget, and the
// other-ticket-running banner.
import { useCallback, useEffect, useState } from 'react';
import { useOrgToday } from '../../../utils/orgDate';
import {
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconPlayerPauseFilled,
  IconAlertTriangle,
} from '@tabler/icons-react';
import api, { errMessage } from '../../../api/api';
import { formatHMS } from '../../../context/TimerContext';
import { formatTicketId } from '../../../utils/ticketId';
import {
  CARD_BG,
  BORDER,
  TEXT,
  MUTED,
  BLUE,
  TIMER_COLOR,
  buildLocalDateTime,
  fieldStyle,
} from '../theme';
import { Modal } from './Modal';
import { TimeEntryFields, LoggedForField } from './TimeFields';

function roundToNearest5(date) {
  const mins = date.getHours() * 60 + date.getMinutes();
  return Math.round(mins / 5) * 5;
}

// ---- Header timer widget: client-side state machine (idle/running/paused) ----
//
// Deliberately independent of the shared server-backed TimerContext (which
// still drives the simpler start/stop-only Project timer elsewhere in the
// app) — the pause state below has no equivalent in that schema, and
// persisting to localStorage is the simplest way to survive an accidental
// navigation away and back without a server round trip.

const TICKET_TIMER_KEY = 'prism.ticketTimer.v1';

function readTicketTimerEntry() {
  try {
    const raw = localStorage.getItem(TICKET_TIMER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeTicketTimerEntry(entry) {
  try {
    if (entry) localStorage.setItem(TICKET_TIMER_KEY, JSON.stringify(entry));
    else localStorage.removeItem(TICKET_TIMER_KEY);
  } catch {
    /* ignore (private browsing / storage full) */
  }
}

function computeElapsedSeconds(entry, nowMs) {
  if (!entry) return 0;
  const running = entry.state === 'running' ? Math.max(0, Math.floor((nowMs - entry.runStartedAt) / 1000)) : 0;
  return entry.accumulatedSeconds + running;
}

export function useTicketTimer(ticket) {
  const ticketId = ticket?.id ?? null;
  const [entry, setEntry] = useState(() => readTicketTimerEntry());
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second whenever ANY ticket's timer is running (so a banner
  // about a different ticket's timer can show a live count too).
  useEffect(() => {
    if (!entry || entry.state !== 'running') return undefined;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [entry?.state, entry?.runStartedAt]);

  // Pick up changes made in another tab for the same browser.
  useEffect(() => {
    const onStorage = (e) => { if (e.key === TICKET_TIMER_KEY) setEntry(readTicketTimerEntry()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const commit = (next) => { writeTicketTimerEntry(next); setEntry(next); };

  const isForThisTicket = !!(entry && ticketId != null && entry.ticketId === ticketId);
  const timerState = isForThisTicket ? entry.state : 'idle';
  const elapsedSeconds = isForThisTicket ? computeElapsedSeconds(entry, now) : 0;
  const otherTicket = entry && !isForThisTicket ? entry : null;

  const start = useCallback(() => {
    if (ticketId == null) return;
    commit({
      ticketId,
      ticketNumber: formatTicketId(ticket),
      ticketTitle: ticket.title,
      state: 'running',
      accumulatedSeconds: 0,
      runStartedAt: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, ticket?.title]);

  const pause = useCallback(() => {
    if (!entry || entry.ticketId !== ticketId || entry.state !== 'running') return;
    commit({ ...entry, state: 'paused', accumulatedSeconds: computeElapsedSeconds(entry, Date.now()), runStartedAt: null });
  }, [entry, ticketId]);

  const resume = useCallback(() => {
    if (!entry || entry.ticketId !== ticketId || entry.state !== 'paused') return;
    commit({ ...entry, state: 'running', runStartedAt: Date.now() });
  }, [entry, ticketId]);

  // Snapshot-then-clear: used right before opening the Log time modal, and
  // by the automatic-timer-mode unmount path — always resets to idle.
  const stopToIdle = useCallback(() => { commit(null); }, []);
  const clearOther = useCallback(() => { commit(null); }, []);

  // Reconstructs a running/paused timer at a specific accumulated duration —
  // used by the Log Time modal's "Keep timing" option to undo a stop click,
  // resuming exactly where the timer left off rather than restarting at 0.
  const restore = useCallback((state, accumulatedSeconds) => {
    if (ticketId == null) return;
    commit({
      ticketId,
      ticketNumber: formatTicketId(ticket),
      ticketTitle: ticket.title,
      state,
      accumulatedSeconds,
      runStartedAt: state === 'running' ? Date.now() : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, ticket?.title]);

  return { timerState, elapsedSeconds, otherTicket, now, start, pause, resume, stopToIdle, clearOther, restore };
}

export function TimerWidget({ ticket, ticketTimer, onLogged, assignableUsers, canLogTimeForOthers, currentUser }) {
  const { timerState, elapsedSeconds, start, pause, resume, stopToIdle, restore } = ticketTimer;
  const [modalOpen, setModalOpen] = useState(false);
  const [description, setDescription] = useState('');
  const todayStr = useOrgToday();
  const [entryDate, setEntryDate] = useState(todayStr);
  const [startMinutes, setStartMinutes] = useState(0);
  const [endMinutes, setEndMinutes] = useState(30);
  const [loggedForId, setLoggedForId] = useState(currentUser.id);
  const [saving, setSaving] = useState(false);
  // Frozen at the moment Stop is clicked — elapsedSeconds itself resets to 0
  // once stopToIdle() clears the timer, so the modal (and "Keep timing",
  // which needs to know exactly where to resume from) reads these instead.
  const [stoppedSeconds, setStoppedSeconds] = useState(0);
  const [preStopState, setPreStopState] = useState('running');

  const threshold = currentUser.timerMinThreshold || 0;
  const belowThreshold = modalOpen && stoppedSeconds < threshold;

  const color = timerState === 'running' ? TIMER_COLOR : timerState === 'paused' ? 'var(--color-warning)' : TEXT;
  const iconColor = timerState === 'running' ? TIMER_COLOR : timerState === 'paused' ? 'var(--color-warning)' : MUTED;

  const handleStop = () => {
    const stopAt = new Date();
    const startAt = new Date(stopAt.getTime() - elapsedSeconds * 1000);
    setStoppedSeconds(elapsedSeconds);
    setPreStopState(timerState);
    stopToIdle();
    // The 5-minute-increment pickers can't represent the timer's exact
    // wall-clock seconds, so both ends are rounded to the nearest grid line —
    // the tech can nudge either side before saving if that shifts things off.
    // A short session can round both ends into the same 5-minute bucket, so
    // guarantee at least one increment of daylight between them.
    const roundedStart = roundToNearest5(startAt);
    let roundedEnd = roundToNearest5(stopAt);
    if (roundedEnd <= roundedStart) roundedEnd = roundedStart + 5;
    setEntryDate(todayStr);
    setStartMinutes(roundedStart);
    setEndMinutes(roundedEnd);
    setLoggedForId(currentUser.id);
    setDescription('');
    setModalOpen(true);
  };

  const saveEntry = async () => {
    if (endMinutes <= startMinutes) return;
    setSaving(true);
    try {
      const startTime = buildLocalDateTime(entryDate, startMinutes);
      const endTime = buildLocalDateTime(entryDate, endMinutes);
      await api.post(`/tickets/${ticket.id}/time`, {
        startTime,
        endTime,
        note: description || undefined,
        entryDate,
        userId: loggedForId,
      });
      onLogged?.();
    } finally {
      setSaving(false);
      setModalOpen(false);
      setDescription('');
    }
  };

  const discardEntry = () => {
    setModalOpen(false);
    setDescription('');
  };

  // Undoes the stop — the tech changed their mind. Resumes exactly where
  // the timer was (running or paused) with the same accumulated duration,
  // rather than restarting from zero.
  const keepTiming = () => {
    restore(preStopState, stoppedSeconds);
    setModalOpen(false);
    setDescription('');
  };

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex items-center gap-2"
        style={{
          backgroundColor: CARD_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          padding: '6px 14px',
        }}
      >
        {timerState === 'idle' && (
          <button type="button" onClick={start} className="flex items-center justify-center" style={{ color: iconColor }} title="Start timer">
            <IconPlayerPlayFilled size={15} />
          </button>
        )}
        {timerState === 'running' && (
          <button type="button" onClick={pause} className="flex items-center justify-center" style={{ color: iconColor }} title="Pause timer">
            <IconPlayerPauseFilled size={15} />
          </button>
        )}
        {timerState === 'paused' && (
          <button type="button" onClick={resume} className="flex items-center justify-center" style={{ color: iconColor }} title="Resume timer">
            <IconPlayerPlayFilled size={15} />
          </button>
        )}
        <span className="font-mono text-sm font-semibold" style={{ color }}>
          {formatHMS(elapsedSeconds)}
        </span>
        {timerState !== 'idle' && (
          <button type="button" onClick={handleStop} className="flex items-center justify-center" style={{ color }} title="Stop and log time">
            <IconPlayerStopFilled size={15} />
          </button>
        )}
      </div>

      {modalOpen && (
        <Modal title="Log time" onClose={discardEntry}>
          {belowThreshold && (
            <div
              className="mb-4 flex items-start gap-2 rounded-md border p-3 text-sm"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-warning) 12%, var(--color-bg))',
                borderColor: 'var(--color-warning)',
                color: 'var(--color-warning)',
              }}
            >
              <IconAlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <span>
                This entry is {formatHMS(stoppedSeconds)} — below your minimum threshold of {formatHMS(threshold)}.
                You can still log it or discard it.
              </span>
            </div>
          )}
          <TimeEntryFields
            entryDate={entryDate}
            onEntryDateChange={setEntryDate}
            startMinutes={startMinutes}
            onStartMinutesChange={setStartMinutes}
            endMinutes={endMinutes}
            onEndMinutesChange={setEndMinutes}
            todayStr={todayStr}
          />
          {canLogTimeForOthers && (
            <LoggedForField assignableUsers={assignableUsers} currentUser={currentUser} value={loggedForId} onChange={setLoggedForId} />
          )}
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input mb-4 resize-y"
            style={{ ...fieldStyle, minHeight: '70px' }}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={discardEntry}
              className="rounded-md border px-4 py-2 text-sm font-medium"
              style={{ borderColor: BORDER, color: TEXT }}
            >
              Discard
            </button>
            <button
              type="button"
              onClick={keepTiming}
              className="rounded-md border px-4 py-2 text-sm font-medium"
              style={{ borderColor: BORDER, color: TEXT }}
              title={preStopState === 'paused' ? 'Resume paused timer' : 'Resume timer'}
            >
              Keep timing
            </button>
            <button
              type="button"
              onClick={saveEntry}
              disabled={saving || endMinutes <= startMinutes}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: belowThreshold ? 'var(--color-warning)' : BLUE }}
            >
              {saving ? 'Saving…' : belowThreshold ? 'Log anyway' : 'Save time entry'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function OtherTicketTimerBanner({ otherTicket, now, onCleared }) {
  const [busy, setBusy] = useState(false);
  const seconds = computeElapsedSeconds(otherTicket, now);

  const stopAndLog = async () => {
    setBusy(true);
    try {
      const minutes = Math.max(1, Math.round(seconds / 60));
      await api.post(`/tickets/${otherTicket.ticketId}/time`, { durationMinutes: minutes });
      onCleared();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 px-6 py-2 text-sm"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, var(--color-bg))',
        borderBottom: '1px solid var(--color-warning)',
        color: 'var(--color-warning)',
      }}
    >
      <span>
        Timer is running on <span className="font-mono font-semibold">{otherTicket.ticketNumber}</span> ({formatHMS(seconds)}). Stop and log before starting a new one?
      </span>
      <div className="flex flex-shrink-0 gap-2">
        <button
          type="button"
          onClick={stopAndLog}
          disabled={busy}
          className="rounded-md px-3 py-1 text-xs font-semibold disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-warning)', color: 'black' }}
        >
          {busy ? 'Logging…' : 'Stop & log'}
        </button>
        <button
          type="button"
          onClick={onCleared}
          disabled={busy}
          className="rounded-md border px-3 py-1 text-xs font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--color-warning)', color: 'var(--color-warning)' }}
        >
          Discard
        </button>
      </div>
    </div>
  );
}
