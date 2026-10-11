// The one Log time form: new entries, edits, and a stopped timer. Times are
// a start/end on a date, or a plain duration (entries without times, such as
// older ones, stay that way when edited).
import { useEffect, useMemo, useState } from 'react';
import { IconAlertTriangle } from '@tabler/icons-react';
import api, { errMessage } from '../../api/api';
import Modal from '../Modal';
import { useOrgToday } from '../../utils/orgDate';
import { useTimer, formatHMS } from '../../context/TimerContext';
import TimePicker, { roundToNearest5, localDateTime } from './TimePicker';
import { workPaths } from './workPaths';

const field = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' };
const label = 'mb-1 block text-sm font-medium text-[var(--color-text-primary)]';
const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();
const pad = (n) => String(n).padStart(2, '0');
// The browser's local date of an instant, as YYYY-MM-DD.
const localDateOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// A YYYY-MM-DD date moved by a number of days.
function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDateOf(new Date(y, m - 1, d + days));
}
const daysBetween = (a, b) => Math.round((Date.UTC(...b.split('-').map((n, i) => (i === 1 ? n - 1 : Number(n))))
  - Date.UTC(...a.split('-').map((n, i) => (i === 1 ? n - 1 : Number(n))))) / 86400000);

function initialState({ entry, timer, defaultTaskId, today, currentUser }) {
  if (entry) {
    const start = entry.startTime ? new Date(entry.startTime) : null;
    const end = entry.endTime ? new Date(entry.endTime) : null;
    return {
      mode: start && end ? 'span' : 'duration',
      entryDate: entry.entryDate,
      // Start and end are wall-clock times in this browser's zone, on this
      // local date (which can differ from the work date, kept in the
      // organization's zone). Changing the work date moves it alike.
      spanDate: start ? localDateOf(start) : entry.entryDate,
      startMinutes: start ? minutesOfDay(start) : 9 * 60,
      endMinutes: end ? minutesOfDay(end) : 9 * 60 + Math.round(entry.durationSeconds / 60),
      minutes: Math.round(entry.durationSeconds / 60),
      taskId: entry.taskId || '',
      workTypeId: entry.workTypeId || '',
      billable: !!entry.billable,
      userId: entry.userId,
      note: entry.note || '',
    };
  }
  const end = new Date();
  const seconds = timer ? timer.elapsedSeconds : 30 * 60;
  const startMinutes = roundToNearest5(new Date(end.getTime() - seconds * 1000));
  let endMinutes = roundToNearest5(end);
  if (endMinutes <= startMinutes) endMinutes = startMinutes + 5;
  // A timer that ran past midnight (or a day or more) has no start and end on
  // one date: log it as a plain duration.
  const crossesMidnight = seconds / 60 > end.getHours() * 60 + end.getMinutes();
  return {
    mode: crossesMidnight ? 'duration' : 'span', entryDate: today, spanDate: localDateOf(end), startMinutes, endMinutes, minutes: Math.max(1, Math.round(seconds / 60)),
    taskId: (timer && timer.taskId) || defaultTaskId || '', workTypeId: '', billable: true, userId: currentUser.id, note: '',
  };
}

export default function TimeEntryForm({
  kind, parentId, tasks = [], entry = null, timer = null, defaultTaskId = null,
  canManageOthers, currentUser, assignableUsers = [], onSaved, onClose,
}) {
  const today = useOrgToday();
  const timerCtx = useTimer();
  const paths = workPaths(kind, parentId);
  const [form, setForm] = useState(() => initialState({ entry, timer, defaultTaskId, today, currentUser }));
  const [workTypes, setWorkTypes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    api.get('/work-types').then(({ data }) => {
      setWorkTypes(data.workTypes);
      // A new entry starts on the side's default type, billable as that type says.
      if (!entry) {
        const preferred = kind === 'ticket' ? 'Remote support' : 'Project work';
        const active = data.workTypes.filter((t) => t.isActive);
        const def = active.find((t) => t.name === preferred) || active[0];
        if (def) setForm((f) => ({ ...f, workTypeId: def.id, billable: def.billableDefault }));
      }
    }).catch(() => {});
  }, [entry, kind]);

  // Active types, plus the entry's own type even if it was since deactivated.
  const typeOptions = useMemo(
    () => workTypes.filter((t) => t.isActive || t.id === form.workTypeId),
    [workTypes, form.workTypeId]
  );
  const threshold = currentUser.timerMinThreshold || 0;
  const belowThreshold = !!timer && timer.elapsedSeconds < threshold;
  const spanOk = form.mode === 'duration' ? Number(form.minutes) > 0 : form.endMinutes > form.startMinutes;
  const taskOptions = tasks.flatMap((t) => [t, ...(t.subtasks || []).map((s) => ({ ...s, title: `  ${s.title}` }))]);

  const save = async () => {
    if (!spanOk) return;
    if (form.entryDate > today) { setError('The date cannot be in the future'); return; }
    setSaving(true);
    setError('');
    const body = {
      entryDate: form.entryDate,
      taskId: form.taskId || null,
      workTypeId: form.workTypeId || undefined,
      billable: form.billable,
      note: form.note,
      ...(canManageOthers ? { userId: form.userId } : {}),
      ...(form.mode === 'duration'
        ? { durationMinutes: Number(form.minutes), ...(entry && entry.startTime ? { startTime: null, endTime: null } : {}) }
        : { startTime: localDateTime(form.spanDate, form.startMinutes), endTime: localDateTime(form.spanDate, form.endMinutes) }),
    };
    try {
      if (entry) await api.patch(paths.entry(entry.id), body);
      // A stopped timer is logged as this entry and cleared in one call, and
      // only if it is still the timer this form is for (plan 3c review).
      else if (timer) await timerCtx.stop({ expectTimerId: timer.timerId, entry: body });
      else await api.post(paths.time, body);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const discardTimer = async () => {
    try {
      await timerCtx.stop({ expectTimerId: timer.timerId, discard: true });
    } catch (err) {
      if (err?.response?.status !== 409) { setError(errMessage(err)); return; }
      timerCtx.refresh(); // already logged or replaced elsewhere: nothing to discard
    }
    onClose();
  };
  const keepTiming = async () => { if (timer?.resumeAfter) await timerCtx.resume(); onClose(); };

  return (
    <Modal title={entry ? 'Edit time entry' : 'Log time'} onClose={timer ? keepTiming : onClose}>
      {belowThreshold && (
        <div className="mb-4 flex items-start gap-2 rounded-md border p-3 text-sm" style={{ borderColor: 'var(--color-warning)', color: 'var(--color-warning)' }}>
          <IconAlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>This entry is {formatHMS(timer.elapsedSeconds)}, below your minimum of {formatHMS(threshold)}. You can still log it or discard it.</span>
        </div>
      )}
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <label className={label} htmlFor="te-date">Date</label>
      <input id="te-date" type="date" max={today} value={form.entryDate} onChange={(e) => e.target.value && set({ entryDate: e.target.value, spanDate: shiftDate(form.spanDate, daysBetween(form.entryDate, e.target.value)) })} className="input mb-3" style={field} />
      <div className="mb-2 flex gap-3 text-sm">
        <label className="flex items-center gap-1"><input type="radio" checked={form.mode === 'span'} onChange={() => set({ mode: 'span' })} /> Start and end</label>
        <label className="flex items-center gap-1"><input type="radio" checked={form.mode === 'duration'} onChange={() => set({ mode: 'duration' })} /> Duration</label>
      </div>
      {form.mode === 'span' ? (
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div><span className={label}>Start</span><TimePicker idPrefix="Start" minutesOfDay={form.startMinutes} onChange={(m) => set({ startMinutes: m })} /></div>
          <div><span className={label}>End</span><TimePicker idPrefix="End" minutesOfDay={form.endMinutes} onChange={(m) => set({ endMinutes: m })} /></div>
        </div>
      ) : (
        <div className="mb-3">
          <label className={label} htmlFor="te-minutes">Minutes</label>
          <input id="te-minutes" type="number" min="1" value={form.minutes} onChange={(e) => set({ minutes: e.target.value })} className="input" style={field} />
        </div>
      )}
      {!spanOk && <p className="mb-3 text-sm" style={{ color: 'var(--color-danger)' }}>{form.mode === 'span' ? 'End time must be after start time' : 'Enter the minutes worked'}</p>}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="te-type">Work type</label>
          <select id="te-type" className="input" style={field} value={form.workTypeId}
            onChange={(e) => {
              const t = workTypes.find((x) => x.id === Number(e.target.value));
              set({ workTypeId: Number(e.target.value), ...(t ? { billable: t.billableDefault } : {}) });
            }}>
            {typeOptions.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isActive ? '' : ' (inactive)'}</option>)}
          </select>
        </div>
        <label className="mt-6 flex items-center gap-2 text-sm" htmlFor="te-billable">
          <input id="te-billable" type="checkbox" checked={form.billable} onChange={(e) => set({ billable: e.target.checked })} /> Billable
        </label>
      </div>
      {taskOptions.length > 0 && (
        <>
          <label className={label} htmlFor="te-task">Task</label>
          <select id="te-task" className="input mb-3" style={field} value={form.taskId} onChange={(e) => set({ taskId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">No specific task</option>
            {taskOptions.map((t) => <option key={t.id} value={t.id}>{t.code ? `${t.code} ` : ''}{t.title}</option>)}
          </select>
        </>
      )}
      {canManageOthers && (
        <>
          <label className={label} htmlFor="te-user">Logged for</label>
          <select id="te-user" className="input mb-3" style={field} value={form.userId} onChange={(e) => set({ userId: Number(e.target.value) })}>
            <option value={currentUser.id}>Yourself ({currentUser.displayName})</option>
            {assignableUsers.filter((u) => u.id !== currentUser.id).map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
        </>
      )}
      <label className={label} htmlFor="te-note">Note</label>
      <textarea id="te-note" className="input mb-4 resize-y" style={{ ...field, minHeight: '60px' }} value={form.note} onChange={(e) => set({ note: e.target.value })} />
      <div className="flex flex-wrap justify-end gap-2">
        {timer ? (
          <>
            <button type="button" onClick={discardTimer} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--color-border)' }}>Discard</button>
            <button type="button" onClick={keepTiming} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--color-border)' }}>Keep timing</button>
          </>
        ) : (
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--color-border)' }}>Cancel</button>
        )}
        <button type="button" onClick={save} disabled={saving || !spanOk}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: belowThreshold ? 'var(--color-warning)' : 'var(--color-accent)' }}>
          {saving ? 'Saving…' : belowThreshold ? 'Log anyway' : 'Save time entry'}
        </button>
      </div>
    </Modal>
  );
}
