import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  IconPaperclip, IconAt, IconArrowUp, IconArrowDown, IconX, IconUpload,
  IconFile, IconTrash, IconPlayerPlayFilled, IconPlayerStopFilled, IconPlayerPauseFilled,
  IconLock, IconWorld,
} from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { formatHMS } from '../context/TimerContext';
import Spinner from '../components/Spinner';
import { formatTicketId } from '../utils/ticketId';

// Colors read from the admin-customizable theme CSS variables (Settings -> Appearance).
const BG = 'var(--color-bg)';
const CARD_BG = 'var(--color-card)';
const BORDER = 'var(--color-border)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BLUE = 'var(--color-accent)';
const TIMER_COLOR = 'var(--color-timer)';
const PURPLE = '#7c3aed';
const PURPLE_LIGHT = '#a78bfa';
const SIDEBAR_STORAGE_KEY = 'prism.ticketDetail.sidebar';

const PRIORITY_OPTIONS = [
  { value: 'critical', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];
const TYPE_OPTIONS = [
  { value: 'incident', label: 'Incident' },
  { value: 'request', label: 'Request' },
  { value: 'problem', label: 'Problem' },
  { value: 'task', label: 'Task' },
  { value: 'change', label: 'Change' },
];
const PRIORITY_META = {
  critical: { label: 'Urgent', color: '#f87171' },
  high: { label: 'High', color: '#fbbf24' },
  medium: { label: 'Medium', color: '#3b82f6' },
  low: { label: 'Low', color: '#94a3b8' },
};
// Status name -> {color, behaviorType} lookup built from the fetched
// ticket-statuses list (Settings -> Statuses), replacing what used to be a
// fixed label/class map — colors are now arbitrary admin-chosen hex values.
function findStatus(ticketStatuses, name) {
  return ticketStatuses.find((s) => s.name === name) || null;
}
const TABS = [
  { key: 'conversation', label: 'Conversation' },
  { key: 'resolution', label: 'Resolution' },
  { key: 'time', label: 'Time Entries' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'attachments', label: 'Attachments' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'activity', label: 'Activity' },
];

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}
function formatMinutes(min) {
  const m = Number(min) || 0;
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(dateStr);
}
function dueDateColor(dueDate) {
  if (!dueDate) return MUTED;
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const soonStr = soon.toISOString().slice(0, 10);
  if (dueDate < today) return '#f87171';
  if (dueDate <= soonStr) return '#fbbf24';
  return MUTED;
}

// ---- Start/End time picker helpers (5-minute increments, 12h + AM/PM) ----

const PICKER_HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const PICKER_MINUTES_5 = Array.from({ length: 12 }, (_, i) => i * 5);

function minutesOfDayToParts(totalMinutes) {
  const norm = ((totalMinutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(norm / 60);
  const m = norm % 60;
  const meridiem = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { h12, m, meridiem };
}
function partsToMinutesOfDay(h12, m, meridiem) {
  let h24 = h12 % 12;
  if (meridiem === 'PM') h24 += 12;
  return h24 * 60 + m;
}
function roundDownTo5(date) {
  const mins = date.getHours() * 60 + date.getMinutes();
  return mins - (mins % 5);
}
function roundToNearest5(date) {
  const mins = date.getHours() * 60 + date.getMinutes();
  return Math.round(mins / 5) * 5;
}
// Combines a YYYY-MM-DD date with minutes-since-midnight into a local
// datetime string suitable for `new Date(...)` on either side of the wire —
// only the DIFFERENCE between two such values is ever used, so timezone
// offset doesn't matter as long as both are constructed the same way.
function buildLocalDateTime(dateStr, minutesOfDay) {
  const h = Math.floor(minutesOfDay / 60);
  const m = minutesOfDay % 60;
  return `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function TimePicker({ minutesOfDay, onChange }) {
  const { h12, m, meridiem } = minutesOfDayToParts(minutesOfDay);
  const update = (nh12, nm, nMeridiem) => onChange(partsToMinutesOfDay(nh12, nm, nMeridiem));
  return (
    <div className="flex gap-2">
      <select value={h12} onChange={(e) => update(Number(e.target.value), m, meridiem)} className="input h-9 text-sm" style={fieldStyle}>
        {PICKER_HOURS_12.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <select value={m} onChange={(e) => update(h12, Number(e.target.value), meridiem)} className="input h-9 text-sm" style={fieldStyle}>
        {PICKER_MINUTES_5.map((mm) => <option key={mm} value={mm}>{String(mm).padStart(2, '0')}</option>)}
      </select>
      <select value={meridiem} onChange={(e) => update(h12, m, e.target.value)} className="input h-9 text-sm" style={fieldStyle}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

// Shared Date + Start Time + End Time + auto-calculated Duration block, used
// by both the manual time entry modal and the timer's log modal.
function TimeEntryFields({ entryDate, onEntryDateChange, startMinutes, onStartMinutesChange, endMinutes, onEndMinutesChange, todayStr }) {
  const durationMin = endMinutes - startMinutes;
  const valid = durationMin > 0;
  return (
    <>
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Date</label>
      <input
        type="date"
        value={entryDate}
        max={todayStr}
        onChange={(e) => onEntryDateChange(e.target.value)}
        className="input mb-3"
        style={fieldStyle}
      />

      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Start Time</label>
      <div className="mb-3">
        <TimePicker minutesOfDay={startMinutes} onChange={onStartMinutesChange} />
      </div>

      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>End Time</label>
      <div className="mb-3">
        <TimePicker minutesOfDay={endMinutes} onChange={onEndMinutesChange} />
      </div>

      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Duration</label>
      <div
        className="mb-3 rounded-md border px-3 py-2 font-mono text-sm font-semibold"
        style={{
          borderColor: valid ? '#16a34a' : '#dc2626',
          color: valid ? '#4ade80' : '#f87171',
          backgroundColor: BG,
        }}
      >
        {valid ? formatMinutes(durationMin) : 'End time must be after start time'}
      </div>
    </>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-[10px] border p-5"
        style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold" style={{ color: TEXT }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

const fieldStyle = { backgroundColor: BG, borderColor: BORDER, color: TEXT };

// Shared by the manual time entry modal and the timer's log modal — only
// rendered at all when the caller has confirmed canLogTimeForOthers, so no
// permission check happens here.
function LoggedForField({ assignableUsers, currentUser, value, onChange }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Logged for</label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input h-9 text-sm"
        style={fieldStyle}
      >
        <option value={currentUser.id}>Yourself ({currentUser.displayName})</option>
        {assignableUsers
          .filter((u) => u.id !== currentUser.id)
          .map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
      </select>
    </div>
  );
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

function useTicketTimer(ticket) {
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

  return { timerState, elapsedSeconds, otherTicket, now, start, pause, resume, stopToIdle, clearOther };
}

function TimerWidget({ ticket, ticketTimer, onLogged, assignableUsers, canLogTimeForOthers, currentUser }) {
  const { timerState, elapsedSeconds, start, pause, resume, stopToIdle } = ticketTimer;
  const [modalOpen, setModalOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startMinutes, setStartMinutes] = useState(0);
  const [endMinutes, setEndMinutes] = useState(30);
  const [loggedForId, setLoggedForId] = useState(currentUser.id);
  const [saving, setSaving] = useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);

  const color = timerState === 'running' ? TIMER_COLOR : timerState === 'paused' ? '#f59e0b' : TEXT;
  const iconColor = timerState === 'running' ? TIMER_COLOR : timerState === 'paused' ? '#f59e0b' : MUTED;

  const handleStop = () => {
    const stopAt = new Date();
    const startAt = new Date(stopAt.getTime() - elapsedSeconds * 1000);
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
              onClick={saveEntry}
              disabled={saving || endMinutes <= startMinutes}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: BLUE }}
            >
              {saving ? 'Saving…' : 'Save time entry'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function OtherTicketTimerBanner({ otherTicket, now, onCleared }) {
  const [busy, setBusy] = useState(false);
  const seconds = computeElapsedSeconds(otherTicket, now);

  const stopAndLog = async () => {
    setBusy(true);
    try {
      const minutes = Math.max(1, Math.round(seconds / 60));
      await api.post(`/tickets/${otherTicket.ticketId}/time`, { minutes });
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
      style={{ backgroundColor: '#2d1f00', borderBottom: '1px solid #f59e0b', color: '#fbbf24' }}
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
          style={{ backgroundColor: '#f59e0b', color: '#1a1200' }}
        >
          {busy ? 'Logging…' : 'Stop & log'}
        </button>
        <button
          type="button"
          onClick={onCleared}
          disabled={busy}
          className="rounded-md border px-3 py-1 text-xs font-medium disabled:opacity-50"
          style={{ borderColor: '#f59e0b', color: '#fbbf24' }}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

// ---- Sidebar ----

function SidebarSection({ title, collapsed, children }) {
  if (collapsed) return children;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{title}</h3>
      {children}
    </div>
  );
}

function Sidebar({
  ticket, collapsed, onToggle, isStaff, onStatusChange, patchTicket,
  assignableUsers, teams, directory, ticketStatuses,
  tags, onAddTag, onRemoveTag,
  watchers, onAddWatcher, onRemoveWatcher,
}) {
  const [tagInput, setTagInput] = useState('');
  const [watcherQuery, setWatcherQuery] = useState('');
  const watcherResults = watcherQuery.trim()
    ? directory
        .filter(
          (u) =>
            u.displayName.toLowerCase().includes(watcherQuery.trim().toLowerCase()) &&
            !watchers.some((w) => w.userId === u.id)
        )
        .slice(0, 6)
    : [];

  const width = collapsed ? 44 : 240;

  return (
    <aside
      className="relative flex-shrink-0 transition-all"
      style={{
        width,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRight: `1px solid ${BORDER}`,
        backgroundColor: CARD_BG,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex-shrink-0 flex items-center text-sm"
        style={{
          width: '100%',
          height: 36,
          padding: '0 12px',
          justifyContent: collapsed ? 'center' : 'flex-end',
          backgroundColor: '#141a2b',
          borderBottom: `1px solid ${BORDER}`,
          color: TEXT,
        }}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '›' : '‹'}
      </button>

      <div
        className={collapsed ? 'flex flex-col items-center gap-4 pt-4' : 'space-y-5 p-4'}
        style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}
      >
        <SidebarSection title="Contact Info" collapsed={collapsed}>
          {collapsed ? (
            <span title={`${ticket.requester?.displayName} · ${ticket.requester?.department?.name || 'No department'} · ${ticket.requester?.email || 'no email'}`} className="text-lg">👤</span>
          ) : (
            <dl className="space-y-1.5 text-sm">
              <div><dt className="text-xs" style={{ color: MUTED }}>Name</dt><dd style={{ color: TEXT }}>{ticket.requester?.displayName || '—'}</dd></div>
              <div><dt className="text-xs" style={{ color: MUTED }}>Department</dt><dd style={{ color: TEXT }}>{ticket.requester?.department?.name || '—'}</dd></div>
              <div><dt className="text-xs" style={{ color: MUTED }}>Email</dt><dd style={{ color: TEXT }}>{ticket.requester?.email || '—'}</dd></div>
            </dl>
          )}
        </SidebarSection>

        <SidebarSection title="Ticket Info" collapsed={collapsed}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-4">
              <span title={`Status: ${ticket.status}`}>●</span>
              <span title={`Priority: ${PRIORITY_META[ticket.priority]?.label}`} style={{ color: PRIORITY_META[ticket.priority]?.color }}>●</span>
              <span title={`Type: ${ticket.type}`}>▣</span>
              <span title={`Assignee: ${ticket.assignee?.displayName || 'Unassigned'}`}>🧑</span>
              <span title={`Team: ${ticket.team?.name || 'No team'}`}>👥</span>
              <span title={`Due: ${ticket.dueDate || 'None'}`}>📅</span>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs" style={{ color: MUTED }}>Status</label>
                <select
                  disabled={!isStaff}
                  value={ticket.status}
                  onChange={(e) => onStatusChange(e.target.value)}
                  className="input h-9 text-sm"
                  style={fieldStyle}
                >
                  {ticketStatuses.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: MUTED }}>Priority</label>
                <select
                  disabled={!isStaff}
                  value={ticket.priority}
                  onChange={(e) => patchTicket({ priority: e.target.value })}
                  className="input h-9 text-sm"
                  style={fieldStyle}
                >
                  {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: MUTED }}>Type</label>
                <select
                  disabled={!isStaff}
                  value={ticket.type}
                  onChange={(e) => patchTicket({ type: e.target.value })}
                  className="input h-9 text-sm"
                  style={fieldStyle}
                >
                  {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: MUTED }}>Assignee</label>
                <select
                  disabled={!isStaff}
                  value={ticket.assigneeId || ''}
                  onChange={(e) => patchTicket({ assigneeId: e.target.value || null })}
                  className="input h-9 text-sm"
                  style={fieldStyle}
                >
                  <option value="">Unassigned</option>
                  {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: MUTED }}>Team</label>
                <select
                  disabled={!isStaff}
                  value={ticket.teamId || ''}
                  onChange={(e) => patchTicket({ teamId: e.target.value || null })}
                  className="input h-9 text-sm"
                  style={fieldStyle}
                >
                  <option value="">No team</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: MUTED }}>Due Date</label>
                <input
                  type="date"
                  disabled={!isStaff}
                  value={ticket.dueDate || ''}
                  onChange={(e) => patchTicket({ dueDate: e.target.value || null })}
                  className="input h-9 text-sm"
                  style={fieldStyle}
                />
              </div>
            </div>
          )}
        </SidebarSection>

        <SidebarSection title="Tags" collapsed={collapsed}>
          {collapsed ? (
            <span title={(tags || []).join(', ') || 'No tags'}>🏷</span>
          ) : (
            <div>
              <div className="flex flex-wrap gap-1.5">
                {(tags || []).map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: BORDER, color: TEXT }}>
                    {tag}
                    <button type="button" onClick={() => onRemoveTag(tag)} style={{ color: MUTED }}><IconX size={11} /></button>
                  </span>
                ))}
              </div>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tagInput.trim()) { e.preventDefault(); onAddTag(tagInput.trim()); setTagInput(''); }
                }}
                placeholder="Add a tag…"
                className="input mt-2 h-8 text-xs"
                style={fieldStyle}
              />
            </div>
          )}
        </SidebarSection>

        <SidebarSection title="Watchers" collapsed={collapsed}>
          {collapsed ? (
            <span title={watchers.map((w) => w.user?.displayName).join(', ') || 'No watchers'}>👁</span>
          ) : (
            <div>
              <div className="space-y-1.5">
                {watchers.map((w) => (
                  <span key={w.id} className="flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 text-xs font-medium" style={{ backgroundColor: BORDER, color: TEXT }}>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold" style={{ backgroundColor: CARD_BG, color: '#93c5fd' }}>
                      {initials(w.user?.displayName)}
                    </span>
                    {w.user?.displayName}
                    <button type="button" onClick={() => onRemoveWatcher(w.userId)} style={{ color: MUTED }}><IconX size={11} /></button>
                  </span>
                ))}
                {watchers.length === 0 && <p className="text-xs" style={{ color: MUTED }}>No watchers.</p>}
              </div>
              <div className="relative mt-2">
                <input
                  value={watcherQuery}
                  onChange={(e) => setWatcherQuery(e.target.value)}
                  placeholder="+ Add watcher…"
                  className="input h-8 text-xs"
                  style={fieldStyle}
                />
                {watcherResults.length > 0 && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-md border p-1 shadow-lg" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
                    {watcherResults.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => { onAddWatcher(u.id); setWatcherQuery(''); }}
                        className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-white/5"
                        style={{ color: TEXT }}
                      >
                        {u.displayName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </SidebarSection>
      </div>
    </aside>
  );
}

// ---- Conversation tab ----

function ConversationTab({ ticket, comments }) {
  return (
    <div className="space-y-4">
      {comments.length === 0 && <p className="text-sm" style={{ color: MUTED }}>No messages yet.</p>}
      {comments.map((c) => {
        const isCustomer = c.authorId === ticket.requesterId;
        const isPrivate = c.type === 'comment_private';
        const isPublicComment = c.type === 'comment_public';
        return (
          <div key={c.id} className="flex items-start gap-3">
            <span
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
              style={{ backgroundColor: isCustomer ? '#3b82f6' : '#22c55e' }}
            >
              {initials(c.author?.displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: TEXT }}>{c.author?.displayName}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={isCustomer ? { backgroundColor: '#0d2847', color: '#60a5fa' } : { backgroundColor: '#0c2a1a', color: '#4ade80' }}
                >
                  {isCustomer ? 'Customer' : 'Tech'}
                </span>
                {isPrivate && (
                  <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: '#3a2a00', color: '#f59e0b' }}>
                    <IconLock size={10} /> Private comment
                  </span>
                )}
                {isPublicComment && (
                  <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: '#0d2847', color: '#60a5fa' }}>
                    <IconWorld size={10} /> Comment
                  </span>
                )}
                <span className="text-xs" style={{ color: MUTED }}>{timeAgo(c.createdAt)}</span>
              </div>
              <div
                className="mt-1 rounded-[10px] border p-3 text-sm"
                style={{
                  backgroundColor: isPrivate ? '#1a1200' : CARD_BG,
                  borderColor: isPrivate ? '#f59e0b' : BORDER,
                  color: TEXT,
                }}
              >
                <p className="whitespace-pre-wrap">{c.body}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const AMBER = '#f59e0b';

function ReplyBox({ ticket, onSend, fileRef, onAttach, isStaff }) {
  const draftKey = `prism.ticket.${ticket.id}.draft`;
  const [text, setText] = useState(() => { try { return localStorage.getItem(draftKey) || ''; } catch { return ''; } });
  const [mode, setMode] = useState('reply'); // 'reply' | 'comment'
  const [visibility, setVisibility] = useState('private'); // 'private' | 'public'
  const [sending, setSending] = useState(false);
  const textareaRef = useRef(null);

  const isComment = isStaff && mode === 'comment';

  const saveDraft = () => { try { localStorage.setItem(draftKey, text); } catch { /* ignore */ } };

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const type = isComment ? (visibility === 'public' ? 'comment_public' : 'comment_private') : 'reply';
      await onSend(text, type);
      setText('');
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    } finally {
      setSending(false);
    }
  };

  const insertAt = () => {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? text.length;
    setText(text.slice(0, pos) + '@' + text.slice(pos));
  };

  const tabStyle = (active, activeColor) => ({
    padding: '4px 12px',
    fontSize: '0.75rem',
    fontWeight: 600,
    backgroundColor: active ? activeColor : 'transparent',
    color: active ? '#0d1120' : MUTED,
  });

  return (
    <div className="flex-shrink-0 border-t p-4" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={isComment ? 'Add an internal comment...' : `Reply to ${ticket.requester?.displayName || 'the customer'}...`}
        className="input resize-y"
        style={{ ...fieldStyle, minHeight: '80px', borderColor: isComment ? AMBER : BORDER }}
      />

      {isStaff && (
        <div className="mt-2 flex items-center justify-between">
          <div className="flex overflow-hidden rounded-md border" style={{ borderColor: BORDER }}>
            <button type="button" onClick={() => setMode('reply')} style={tabStyle(mode === 'reply', BLUE)}>
              Reply
            </button>
            <button type="button" onClick={() => setMode('comment')} style={tabStyle(mode === 'comment', AMBER)}>
              Comment
            </button>
          </div>
          {isComment && (
            <div className="flex overflow-hidden rounded-md border" style={{ borderColor: BORDER }}>
              <button
                type="button"
                onClick={() => setVisibility('private')}
                className="flex items-center gap-1"
                style={tabStyle(visibility === 'private', AMBER)}
              >
                <IconLock size={12} /> Private
              </button>
              <button
                type="button"
                onClick={() => setVisibility('public')}
                className="flex items-center gap-1"
                style={tabStyle(visibility === 'public', '#60a5fa')}
              >
                <IconWorld size={12} /> Public
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} title="Attach a file" className="rounded-md border p-2" style={{ borderColor: BORDER, color: MUTED }}>
            <IconPaperclip size={16} />
          </button>
          <input ref={fileRef} type="file" className="hidden" onChange={onAttach} />
          <button type="button" onClick={insertAt} title="Mention someone" className="rounded-md border p-2" style={{ borderColor: BORDER, color: MUTED }}>
            <IconAt size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={saveDraft} className="rounded-md border px-3 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>
            Save draft
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || !text.trim()}
            className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: isComment ? AMBER : BLUE, color: isComment ? '#0d1120' : '#fff' }}
          >
            {sending ? 'Sending…' : isComment ? 'Add Comment' : 'Send Reply'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Resolution tab ----

function ResolutionTab({ ticket, onSave, isStaff }) {
  const [text, setText] = useState(ticket.resolution || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setText(ticket.resolution || ''); }, [ticket.resolution]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(text);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold" style={{ color: TEXT }}>Resolution</h3>
      <p className="mb-3 text-xs" style={{ color: MUTED }}>
        Document what resolved this ticket. This may be used for future reference and knowledge base articles.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!isStaff}
        placeholder="Describe what resolved this issue..."
        className="input resize-y disabled:opacity-70"
        style={{ ...fieldStyle, minHeight: '220px' }}
      />
      {ticket.resolutionUpdatedByUser && ticket.resolutionUpdatedAt && (
        <p className="mt-2 text-xs" style={{ color: MUTED }}>
          Last updated by {ticket.resolutionUpdatedByUser.displayName} on {formatDate(ticket.resolutionUpdatedAt)}
        </p>
      )}
      {isStaff && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: BLUE }}
          >
            {saving ? 'Saving…' : 'Save Resolution'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Time entries tab ----

function TimeEntriesTab({ entries, totalMinutes, onAdd, assignableUsers, canLogTimeForOthers, currentUser }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [modalOpen, setModalOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [entryDate, setEntryDate] = useState(todayStr);
  const [startMinutes, setStartMinutes] = useState(0);
  const [endMinutes, setEndMinutes] = useState(30);
  const [loggedForId, setLoggedForId] = useState(currentUser.id);
  const [saving, setSaving] = useState(false);

  const openModal = () => {
    const now = new Date();
    const start = roundDownTo5(now);
    setEntryDate(todayStr);
    setStartMinutes(start);
    setEndMinutes(start + 30);
    setLoggedForId(currentUser.id);
    setDescription('');
    setModalOpen(true);
  };

  const submit = async () => {
    if (entryDate > todayStr) { alert('Entry date cannot be in the future'); return; }
    if (endMinutes <= startMinutes) { alert('End time must be after start time'); return; }
    setSaving(true);
    try {
      const startTime = buildLocalDateTime(entryDate, startMinutes);
      const endTime = buildLocalDateTime(entryDate, endMinutes);
      await onAdd({ startTime, endTime, description, entryDate, loggedForId });
      setModalOpen(false);
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={openModal}
          className="rounded-md px-3 py-2 text-sm font-semibold text-white"
          style={{ backgroundColor: BLUE }}
        >
          Add manual time entry
        </button>
      </div>
      <div className="overflow-hidden rounded-[10px] border" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
        {entries.length === 0 && <p className="p-4 text-sm" style={{ color: MUTED }}>No time logged.</p>}
        <ul className="divide-y" style={{ borderColor: BORDER }}>
          {entries.map((e) => {
            const loggedByOther = e.loggedById && e.userId != null && e.loggedById !== e.userId;
            const displayMinutes = e.durationSeconds != null ? Math.round(e.durationSeconds / 60) : e.minutes;
            return (
              <li key={e.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm" style={{ color: TEXT }}>{e.note || 'Time entry'}</p>
                  <p className="text-xs" style={{ color: MUTED }}>
                    {loggedByOther
                      ? `Logged by ${e.loggedBy?.displayName || 'someone'} for ${e.user?.displayName}`
                      : e.user?.displayName}
                    {' · '}{formatDate(e.entryDate || e.loggedAt)}
                  </p>
                </div>
                <span className="font-mono text-sm font-semibold" style={{ color: '#4ade80' }}>{formatMinutes(displayMinutes)}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="mt-3 text-right text-sm font-semibold" style={{ color: TEXT }}>
        Total: {formatMinutes(totalMinutes)}
      </div>

      {modalOpen && (
        <Modal title="Add manual time entry" onClose={() => setModalOpen(false)}>
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
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input mb-4 resize-y" style={{ ...fieldStyle, minHeight: '70px' }} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>Cancel</button>
            <button
              type="button"
              onClick={submit}
              disabled={saving || endMinutes <= startMinutes}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: BLUE }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---- Tasks tab ----

function TasksTab({ tasks, assignableUsers, onToggle, onReassign, onAdd }) {
  const [text, setText] = useState('');
  return (
    <div>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-[10px] border p-3" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <input type="checkbox" checked={t.completed} onChange={() => onToggle(t)} className="h-4 w-4 accent-blue-500" />
            <span
              className="flex-1 text-sm"
              style={{ color: t.completed ? MUTED : TEXT, textDecoration: t.completed ? 'line-through' : 'none' }}
            >
              {t.description}
            </span>
            <select
              value={t.assigneeId || ''}
              onChange={(e) => onReassign(t, e.target.value || null)}
              className="input h-8 max-w-[9rem] text-xs"
              style={fieldStyle}
            >
              <option value="">Unassigned</option>
              {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </li>
        ))}
        {tasks.length === 0 && <p className="text-sm" style={{ color: MUTED }}>No tasks yet.</p>}
      </ul>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) { e.preventDefault(); onAdd(text.trim()); setText(''); }
        }}
        placeholder="Add a task and press Enter…"
        className="input mt-3"
        style={fieldStyle}
      />
    </div>
  );
}

// ---- Attachments tab ----

function AttachmentsTab({ ticketId, attachments, onUpload, onRemove }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = (files) => Array.from(files).forEach((f) => onUpload(f));

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {attachments.map((a) => (
          <a
            key={a.id}
            href={`/api/v1/tickets/${ticketId}/attachments/${a.id}/download`}
            className="group relative flex flex-col items-center gap-2 rounded-[10px] border p-4 text-center"
            style={{ borderColor: BORDER, backgroundColor: CARD_BG }}
          >
            <IconFile size={28} style={{ color: MUTED }} />
            <span className="w-full truncate text-xs font-medium" style={{ color: TEXT }}>{a.originalName}</span>
            <span className="text-[10px]" style={{ color: MUTED }}>{(a.size / 1024).toFixed(1)} KB</span>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); onRemove(a.id); }}
              className="absolute right-1 top-1 hidden rounded p-1 group-hover:block"
              style={{ color: MUTED }}
            >
              <IconTrash size={14} />
            </button>
          </a>
        ))}
      </div>
      {attachments.length === 0 && <p className="mb-4 text-sm" style={{ color: MUTED }}>No attachments yet.</p>}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className="mt-4 cursor-pointer rounded-md border-2 border-dashed p-6 text-center"
        style={{ borderColor: dragOver ? BLUE : BORDER, backgroundColor: dragOver ? '#0d1525' : BG }}
      >
        <IconUpload size={22} style={{ color: MUTED, margin: '0 auto' }} />
        <p className="mt-2 text-sm" style={{ color: TEXT }}>Drag &amp; drop files here or browse</p>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
      </div>
    </div>
  );
}

// ---- Relationships tab ----

function RelationLinker({ title, accent, accentLight, Icon, relationType, buttonLabel, helperText, multiple, selected, ticketId, isStaff, onLinked, onUnlink }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return undefined; }
    const t = setTimeout(() => {
      api.get('/tickets', { params: { search: query.trim() } })
        .then(({ data }) => setResults(data.tickets.filter((x) => x.id !== Number(ticketId)).slice(0, 8)))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query, ticketId]);

  const link = async (t) => {
    try {
      await api.post(`/tickets/${ticketId}/relations`, { relatedTicketId: t.id, relationType });
      onLinked();
      setQuery('');
      setResults([]);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const hideInput = !multiple && selected.length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: accent }}>
        <Icon size={16} />
        {title}
      </div>
      {isStaff && !hideInput && (
        <div className="relative mt-2 flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by ticket number or title…" className="input flex-1" style={fieldStyle} />
          <button type="button" onClick={() => results.length && link(results[0])} disabled={!results.length} className="whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-40" style={{ borderColor: accent, color: accentLight }}>
            {buttonLabel}
          </button>
          {results.length > 0 && (
            <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-md border p-1 shadow-lg" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
              {results.map((t) => (
                <button key={t.id} type="button" onClick={() => link(t)} className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-white/5" style={{ color: TEXT }}>
                  {formatTicketId(t)} {t.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {helperText && <p className="mt-1.5 text-xs" style={{ color: MUTED }}>{helperText}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {selected.map((r) => (
          <span key={r.id} className="flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-2 text-xs font-medium" style={{ backgroundColor: `${accent}22`, color: accentLight }}>
            <Icon size={12} />
            <Link to={`/tickets/${r.ticket.id}`} className="hover:underline">{formatTicketId(r.ticket)} {r.ticket.title}</Link>
            {isStaff && (
              <button type="button" onClick={() => onUnlink(r.id)} style={{ color: accentLight }}><IconX size={12} /></button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function RelationshipsTab({ ticketId, relations, isStaff, reload, closedStatusNames }) {
  const parent = relations.filter((r) => r.relationType === 'parent' && r.direction === 'outgoing');
  const children = relations.filter((r) => r.relationType === 'parent' && r.direction === 'incoming');
  const related = relations.filter((r) => r.relationType !== 'parent');

  const closedChildren = children.filter((r) => closedStatusNames.includes(r.ticket.status)).length;
  const childPercent = children.length ? Math.round((closedChildren / children.length) * 100) : 0;

  const unlink = async (relationId) => {
    try {
      await api.delete(`/tickets/${ticketId}/relations/${relationId}`);
      reload();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <RelationLinker
        title="Parent ticket" accent={PURPLE} accentLight={PURPLE_LIGHT} Icon={IconArrowUp}
        relationType="parent" buttonLabel="Link parent" multiple={false}
        selected={parent} ticketId={ticketId} isStaff={isStaff} onLinked={reload} onUnlink={unlink}
        helperText={parent[0] ? `This ticket rolls up to ${formatTicketId(parent[0].ticket)}.` : null}
      />
      <div className="border-t pt-5" style={{ borderColor: BORDER }}>
        <RelationLinker
          title="Child tickets" accent={BLUE} accentLight="#93c5fd" Icon={IconArrowDown}
          relationType="child" buttonLabel="Link child" multiple
          selected={children} ticketId={ticketId} isStaff={isStaff} onLinked={reload} onUnlink={unlink}
        />
        {children.length > 0 && (
          <div className="mt-3">
            <div className="h-[5px] w-full rounded-[3px]" style={{ backgroundColor: BORDER }}>
              <div className="h-full rounded-[3px]" style={{ width: `${childPercent}%`, backgroundColor: BLUE }} />
            </div>
            <p className="mt-1 text-xs" style={{ color: MUTED }}>{closedChildren} of {children.length} children closed ({childPercent}%)</p>
          </div>
        )}
      </div>
      <div className="border-t pt-5" style={{ borderColor: BORDER }}>
        <RelationLinker
          title="Related tickets" accent={MUTED} accentLight="#cbd5e1" Icon={() => null}
          relationType="related" buttonLabel="Link" multiple
          selected={related} ticketId={ticketId} isStaff={isStaff} onLinked={reload} onUnlink={unlink}
        />
      </div>
    </div>
  );
}

// ---- Activity tab ----

const ACTIVITY_DOT = {
  created: '#3b82f6',
  status: '#fbbf24',
  priority: '#f87171',
  type: '#94a3b8',
  assigneeId: '#3b82f6',
  teamId: '#3b82f6',
  departmentId: '#94a3b8',
  dueDate: '#94a3b8',
  comment: '#c084fc',
  time_logged: '#4ade80',
  attachment_added: '#94a3b8',
  relation_added: '#a78bfa',
};
const ACTIVITY_FIELD_LABEL = {
  status: 'status', priority: 'priority', type: 'type', assigneeId: 'assignee',
  teamId: 'team', departmentId: 'department', dueDate: 'due date',
};

function activityDescription(a) {
  const actor = a.user?.displayName || 'Someone';
  if (a.action === 'created') return `${actor} opened this ticket`;
  if (a.action === 'comment') return `${actor} commented on this ticket`;
  if (a.action === 'time_logged') return `${actor} logged ${a.toValue} of time`;
  if (a.action === 'attachment_added') return `${actor} added attachment "${a.toValue}"`;
  if (a.action === 'relation_added') return `${actor} linked ${a.toValue}`;
  if (ACTIVITY_FIELD_LABEL[a.action]) {
    return `${actor} changed ${ACTIVITY_FIELD_LABEL[a.action]} from ${a.fromValue || 'none'} to ${a.toValue || 'none'}`;
  }
  return `${actor} updated this ticket`;
}

function ActivityTab({ activity }) {
  return (
    <ul className="space-y-3">
      {activity.length === 0 && <p className="text-sm" style={{ color: MUTED }}>No activity yet.</p>}
      {activity.map((a) => (
        <li key={a.id} className="flex items-start gap-3">
          <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: ACTIVITY_DOT[a.action] || MUTED }} />
          <div>
            <p className="text-sm" style={{ color: TEXT }}>{activityDescription(a)}</p>
            <p className="text-xs" style={{ color: MUTED }}>{timeAgo(a.createdAt)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---- Main page ----

export default function TicketDetail() {
  const { id } = useParams();
  const { user, isStaff, canLogTimeForOthers } = useAuth();
  const fileRef = useRef(null);

  const [ticket, setTicket] = useState(null);
  const ticketTimer = useTicketTimer(ticket);
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [time, setTime] = useState({ entries: [], totalMinutes: 0 });
  const [relations, setRelations] = useState([]);
  const [watchers, setWatchers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [activity, setActivity] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [ticketStatuses, setTicketStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [activeTab, setActiveTab] = useState('conversation');
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed'; } catch { return false; }
  });
  const [noTimeWarning, setNoTimeWarning] = useState(null);
  const [noResolutionWarning, setNoResolutionWarning] = useState(null);

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded'); } catch { /* ignore */ }
  }, [collapsed]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [t, c, a, tm, rel, w, tk, act] = await Promise.all([
        api.get(`/tickets/${id}`),
        api.get(`/tickets/${id}/comments`),
        api.get(`/tickets/${id}/attachments`),
        api.get(`/tickets/${id}/time`),
        api.get(`/tickets/${id}/relations`),
        api.get(`/tickets/${id}/watchers`),
        api.get(`/tickets/${id}/tasks`),
        api.get(`/tickets/${id}/activity`),
      ]);
      setTicket(t.data.ticket);
      setComments(c.data.comments);
      setAttachments(a.data.attachments);
      setTime(tm.data);
      setRelations(rel.data.relations);
      setWatchers(w.data.watchers);
      setTasks(tk.data.tasks);
      setActivity(act.data.activity);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/users/directory').then(({ data }) => setDirectory(data.users)).catch(() => {});
    api.get('/ticket-statuses').then(({ data }) => setTicketStatuses(data.statuses)).catch(() => {});
    if (isStaff) {
      api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
      api.get('/teams').then(({ data }) => setTeams(data.teams)).catch(() => {});
    }
  }, [isStaff]);

  // Keep a ref to the latest ticket-timer snapshot so the mount/unmount
  // effect below (which only re-runs when the ticket changes) always acts on
  // live data instead of the stale closure from when it first ran.
  const ticketTimerRef = useRef(ticketTimer);
  useEffect(() => { ticketTimerRef.current = ticketTimer; }, [ticketTimer]);

  // Automatic timer mode: start on open (unless another ticket's timer is
  // already running/paused — the warning banner handles that conflict
  // instead), stop (and log/discard/prompt per the user's preferences) on
  // navigating away; best-effort log via sendBeacon on tab close. Manual-mode
  // and paused timers deliberately persist in localStorage across tab
  // close/reopen — that's the point of the client-side persistence.
  useEffect(() => {
    if (!isStaff || !ticket || !user || user.timerMode !== 'automatic') return undefined;

    if (ticketTimerRef.current.timerState === 'idle' && !ticketTimerRef.current.otherTicket) {
      ticketTimerRef.current.start();
    }

    const handleBeforeUnload = () => {
      const t = ticketTimerRef.current;
      if (t.timerState === 'idle') return;
      const seconds = t.elapsedSeconds;
      if (seconds < (user.timerMinThreshold || 0)) return;
      const minutes = Math.max(1, Math.round(seconds / 60));
      navigator.sendBeacon(
        `/api/v1/tickets/${ticket.id}/time`,
        new Blob([JSON.stringify({ minutes })], { type: 'application/json' })
      );
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      const t = ticketTimerRef.current;
      if (t.timerState === 'idle') return;
      const seconds = t.elapsedSeconds;
      if (seconds < (user.timerMinThreshold || 0)) {
        t.stopToIdle();
        return;
      }
      const minutes = Math.max(1, Math.round(seconds / 60));
      if (user.timerPromptBeforeLog) {
        if (window.confirm(`Log ${formatHMS(seconds)} of time to this ticket before leaving?`)) {
          api.post(`/tickets/${ticket.id}/time`, { minutes }).catch(() => {});
        }
      } else {
        api.post(`/tickets/${ticket.id}/time`, { minutes }).catch(() => {});
      }
      t.stopToIdle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, isStaff, user?.id, user?.timerMode]);

  const reloadActivityAndRelations = () => {
    api.get(`/tickets/${id}/relations`).then(({ data }) => setRelations(data.relations)).catch(() => {});
    api.get(`/tickets/${id}/activity`).then(({ data }) => setActivity(data.activity)).catch(() => {});
  };

  const patchTicket = async (changes) => {
    try {
      const { data } = await api.patch(`/tickets/${id}`, changes);
      setTicket(data.ticket);
      api.get(`/tickets/${id}/activity`).then(({ data: d }) => setActivity(d.activity)).catch(() => {});
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const saveResolution = async (text) => {
    await patchTicket({ resolution: text });
  };

  // Which status NAMES currently behave as "closed", per the admin-editable
  // Settings -> Statuses table (behaviorType), rather than a fixed list.
  const closedStatusNames = ticketStatuses.filter((s) => s.behaviorType === 'closed').map((s) => s.name);

  // Status changes now come from the sidebar's Status dropdown (the header's
  // dedicated Resolve/Close buttons were removed). Two independent warnings
  // can fire when moving into a closed state — missing resolution is checked
  // first (arguably the more important gap, since it's customer-visible
  // knowledge-base material), then the pre-existing no-time-logged check;
  // "Close without resolution" falls through into that second check rather
  // than skipping it.
  const applyStatusChange = (status) => {
    if (closedStatusNames.includes(status) && time.totalMinutes === 0) {
      setNoTimeWarning(status);
    } else {
      patchTicket({ status });
    }
  };

  const handleStatusChange = (status) => {
    if (closedStatusNames.includes(status) && !ticket.resolution?.trim()) {
      setNoResolutionWarning(status);
    } else {
      applyStatusChange(status);
    }
  };

  const reloadTime = () => {
    api.get(`/tickets/${id}/time`).then(({ data }) => setTime(data)).catch(() => {});
    api.get(`/tickets/${id}/activity`).then(({ data }) => setActivity(data.activity)).catch(() => {});
  };

  const sendReply = async (body, type) => {
    const { data } = await api.post(`/tickets/${id}/comments`, { body, type });
    setComments((prev) => [...prev, data.comment]);
    api.get(`/tickets/${id}/activity`).then(({ data: d }) => setActivity(d.activity)).catch(() => {});
  };

  const uploadFile = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post(`/tickets/${id}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setAttachments((prev) => [data.attachment, ...prev]);
      api.get(`/tickets/${id}/activity`).then(({ data: d }) => setActivity(d.activity)).catch(() => {});
    } catch (err) {
      alert(errMessage(err));
    }
  };
  const handleReplyAttach = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    if (fileRef.current) fileRef.current.value = '';
  };
  const removeAttachment = async (attId) => {
    if (!confirm('Delete this attachment?')) return;
    try {
      await api.delete(`/tickets/${id}/attachments/${attId}`);
      setAttachments((prev) => prev.filter((a) => a.id !== attId));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const addTag = async (tag) => {
    const nextTags = [...(ticket.tags || []), tag];
    await patchTicket({ tags: nextTags });
  };
  const removeTag = async (tag) => {
    const nextTags = (ticket.tags || []).filter((t) => t !== tag);
    await patchTicket({ tags: nextTags });
  };

  const addWatcher = async (userId) => {
    try {
      const { data } = await api.post(`/tickets/${id}/watchers`, { userId });
      setWatchers((prev) => [...prev, data.watcher]);
    } catch (err) {
      alert(errMessage(err));
    }
  };
  const removeWatcher = async (userId) => {
    try {
      await api.delete(`/tickets/${id}/watchers/${userId}`);
      setWatchers((prev) => prev.filter((w) => w.userId !== userId));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const addTask = async (description) => {
    try {
      const { data } = await api.post(`/tickets/${id}/tasks`, { description });
      setTasks((prev) => [...prev, data.task]);
    } catch (err) {
      alert(errMessage(err));
    }
  };
  const toggleTask = async (task) => {
    try {
      const { data } = await api.patch(`/tickets/${id}/tasks/${task.id}`, { completed: !task.completed });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? data.task : t)));
    } catch (err) {
      alert(errMessage(err));
    }
  };
  const reassignTask = async (task, assigneeId) => {
    try {
      const { data } = await api.patch(`/tickets/${id}/tasks/${task.id}`, { assigneeId });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? data.task : t)));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const addManualTime = async ({ startTime, endTime, description, entryDate, loggedForId }) => {
    const { data } = await api.post(`/tickets/${id}/time`, {
      startTime,
      endTime,
      note: description || undefined,
      entryDate,
      userId: loggedForId,
    });
    setTime((t) => ({ entries: [data.entry, ...t.entries], totalMinutes: t.totalMinutes + data.entry.minutes }));
    api.get(`/tickets/${id}/activity`).then(({ data: d }) => setActivity(d.activity)).catch(() => {});
  };

  if (loading) return <Spinner />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!ticket) return null;

  return (
    <div
      style={{ backgroundColor: BG, margin: '-2rem -1.5rem', padding: 0, height: '100vh' }}
      className="flex flex-col overflow-hidden"
    >
      {/* Header — auto height, does not grow */}
      <div
        className="flex-shrink-0 px-6 py-4"
        style={{ backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}` }}
      >
        <Link to="/tickets" className="text-sm hover:underline" style={{ color: MUTED }}>← Back to tickets</Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-lg" style={{ color: MUTED }}>{formatTicketId(ticket)}</span>
            <h1 className="text-xl font-bold" style={{ color: TEXT }}>{ticket.title}</h1>
            {(() => {
              const statusMeta = findStatus(ticketStatuses, ticket.status);
              const statusColor = statusMeta?.color || MUTED;
              return (
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: `${statusColor}22`, color: statusColor }}
                >
                  {ticket.status}
                </span>
              );
            })()}
            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: PRIORITY_META[ticket.priority].color }}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITY_META[ticket.priority].color }} />
              {PRIORITY_META[ticket.priority].label}
            </span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-3">
            {isStaff && (
              <TimerWidget
                ticket={ticket}
                ticketTimer={ticketTimer}
                onLogged={reloadTime}
                assignableUsers={assignableUsers}
                canLogTimeForOthers={canLogTimeForOthers}
                currentUser={user}
              />
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm" style={{ color: MUTED }}>
          <span>Customer: <span style={{ color: TEXT }}>{ticket.requester?.displayName || '—'}</span></span>
          <span>Assignee: <span style={{ color: TEXT }}>{ticket.assignee?.displayName || 'Unassigned'}</span></span>
          <span>Due: <span style={{ color: dueDateColor(ticket.dueDate) }}>{ticket.dueDate || '—'}</span></span>
          <span>Created: <span style={{ color: TEXT }}>{formatDate(ticket.createdAt)}</span></span>
        </div>
      </div>

      {isStaff && ticketTimer.otherTicket && (
        <OtherTicketTimerBanner
          otherTicket={ticketTimer.otherTicket}
          now={ticketTimer.now}
          onCleared={ticketTimer.clearOther}
        />
      )}

      {/* Body: sidebar + main. flex:1 + min-height:0 + overflow:hidden so this
          row takes exactly the remaining viewport height and its children
          (which scroll internally) never push the page taller than 100vh. */}
      <div className="flex items-stretch" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
        <Sidebar
          ticket={ticket}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          isStaff={isStaff}
          onStatusChange={handleStatusChange}
          patchTicket={patchTicket}
          assignableUsers={assignableUsers}
          teams={teams}
          directory={directory}
          ticketStatuses={ticketStatuses}
          tags={ticket.tags || []}
          onAddTag={addTag}
          onRemoveTag={removeTag}
          watchers={watchers}
          onAddWatcher={addWatcher}
          onRemoveWatcher={removeWatcher}
        />

        <div
          className="min-w-0"
          style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
          <div className="flex-shrink-0 flex" style={{ borderBottom: `1px solid ${BORDER}` }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className="-mb-px border-b-2 px-4 py-3 text-sm font-medium"
                style={{ borderColor: activeTab === t.key ? BLUE : 'transparent', color: activeTab === t.key ? TEXT : MUTED }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-6" style={{ flex: '1 1 auto', overflowY: 'auto', minHeight: 0 }}>
            {activeTab === 'conversation' && <ConversationTab ticket={ticket} comments={comments} />}
            {activeTab === 'resolution' && (
              <ResolutionTab ticket={ticket} onSave={saveResolution} isStaff={isStaff} />
            )}
            {activeTab === 'time' && (
              <TimeEntriesTab
                entries={time.entries}
                totalMinutes={time.totalMinutes}
                onAdd={addManualTime}
                assignableUsers={assignableUsers}
                canLogTimeForOthers={canLogTimeForOthers}
                currentUser={user}
              />
            )}
            {activeTab === 'tasks' && (
              <TasksTab tasks={tasks} assignableUsers={assignableUsers} onToggle={toggleTask} onReassign={reassignTask} onAdd={addTask} />
            )}
            {activeTab === 'attachments' && (
              <AttachmentsTab ticketId={id} attachments={attachments} onUpload={uploadFile} onRemove={removeAttachment} />
            )}
            {activeTab === 'relationships' && (
              <RelationshipsTab ticketId={id} relations={relations} isStaff={isStaff} reload={reloadActivityAndRelations} closedStatusNames={closedStatusNames} />
            )}
            {activeTab === 'activity' && <ActivityTab activity={activity} />}
          </div>

          {/* Sibling below the scrollable tab content, not inside it — stays
              pinned to the bottom of the main content column. */}
          {activeTab === 'conversation' && (
            <ReplyBox ticket={ticket} onSend={sendReply} fileRef={fileRef} onAttach={handleReplyAttach} isStaff={isStaff} />
          )}
        </div>
      </div>

      {noResolutionWarning && (
        <Modal title="No resolution has been documented." onClose={() => setNoResolutionWarning(null)}>
          <p className="mb-4 text-sm" style={{ color: MUTED }}>
            Would you like to add one before closing?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setNoResolutionWarning(null); setActiveTab('resolution'); }}
              className="rounded-md border px-4 py-2 text-sm font-medium"
              style={{ borderColor: BORDER, color: TEXT }}
            >
              Add resolution
            </button>
            <button
              type="button"
              onClick={() => { const status = noResolutionWarning; setNoResolutionWarning(null); applyStatusChange(status); }}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: '#dc2626' }}
            >
              Close without resolution
            </button>
          </div>
        </Modal>
      )}

      {noTimeWarning && (
        <Modal title="No time has been logged on this ticket." onClose={() => setNoTimeWarning(null)}>
          <p className="mb-4 text-sm" style={{ color: MUTED }}>
            You&apos;re about to mark this ticket as {noTimeWarning} without logging any time. This is just a heads-up — you can still proceed.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setNoTimeWarning(null)}
              className="rounded-md border px-4 py-2 text-sm font-medium"
              style={{ borderColor: BORDER, color: TEXT }}
            >
              Go back and log time
            </button>
            <button
              type="button"
              onClick={() => { patchTicket({ status: noTimeWarning }); setNoTimeWarning(null); }}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: '#dc2626' }}
            >
              Close anyway
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
