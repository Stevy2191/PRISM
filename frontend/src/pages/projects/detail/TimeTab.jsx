// Time Entries tab and the Log time modal.
import { useState } from 'react';
import LoadMore from '../../../components/LoadMore';
import {
  CARD_BG,
  BORDER,
  TEXT,
  MUTED,
  BLUE,
  fieldStyle,
  formatSeconds,
  formatCost,
  todayStr,
} from '../theme';
import { Modal } from './Modal';
import { TimeEntryFields } from './TimeFields';

function roundToNearest5(date) {
  const mins = date.getHours() * 60 + date.getMinutes();
  return Math.round(mins / 5) * 5;
}

function buildLocalDateTime(dateStr, minutesOfDay) {
  const h = Math.floor(minutesOfDay / 60);
  const m = minutesOfDay % 60;
  return `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

// ==================== Time entries tab ====================
export function TimeTab({ data, canLogTime, user, isAdmin, onAdd, onDelete, onLoadMore }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <div className="flex items-center justify-between border-b p-4" style={{ borderColor: BORDER }}>
        <h2 className="font-semibold" style={{ color: TEXT }}>Time Entries</h2>
        {canLogTime && <button onClick={onAdd} className="btn-primary">+ Log time</button>}
      </div>
      <table className="min-w-full">
        <thead>
          <tr>
            {['Description', 'Task', 'Logged by', 'Date', 'Duration', 'Cost', ''].map((h) => (
              <th key={h} className="table-th" style={{ borderBottom: `1px solid ${BORDER}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.entries.map((e) => (
            <tr key={e.id}>
              <td className="table-td" style={{ color: TEXT }}>{e.description || '—'}</td>
              <td className="table-td" style={{ color: MUTED }}>{e.task?.title || '—'}</td>
              <td className="table-td" style={{ color: MUTED }}>{e.loggedFor?.displayName || '—'}</td>
              <td className="table-td" style={{ color: MUTED }}>{e.entryDate}</td>
              <td className="table-td font-medium" style={{ color: TEXT }}>{formatSeconds(e.durationSeconds)}</td>
              <td className="table-td" style={{ color: e.laborCost != null ? TEXT : MUTED }}>{e.laborCost != null ? formatCost(e.laborCost) : '—'}</td>
              <td className="table-td">
                {(e.userId === user.id || isAdmin) && (
                  <button onClick={() => onDelete(e.id)} className="text-xs" style={{ color: 'var(--color-danger)' }}>delete</button>
                )}
              </td>
            </tr>
          ))}
          {data.entries.length === 0 && <tr><td colSpan={7} className="table-td" style={{ color: MUTED }}>No time logged yet.</td></tr>}
        </tbody>
      </table>
      <LoadMore loaded={data.entries.length} total={data.total} onLoadMore={onLoadMore} noun="entries" />
      {/* Both figures are summed server-side over the whole project — adding
          up `data.entries` would only cover the rows currently loaded. */}
      <div className="border-t p-4 text-right text-sm font-semibold" style={{ borderColor: BORDER, color: TEXT }}>
        Total: {formatSeconds(data.totalSeconds)}
        {data.totalLaborCost != null && (
          <span className="ml-4">Labor cost: {formatCost(data.totalLaborCost)}</span>
        )}
      </div>
    </div>
  );
}

export function AddTimeModal({ tasks, isAdmin, assignableUsers, onClose, onSave }) {
  const [taskId, setTaskId] = useState('');
  const [description, setDescription] = useState('');
  const [loggedForUserId, setLoggedForUserId] = useState('');
  const [entryDate, setEntryDate] = useState(todayStr());
  const [startMinutes, setStartMinutes] = useState(roundToNearest5(new Date()) - 60);
  const [endMinutes, setEndMinutes] = useState(roundToNearest5(new Date()));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (endMinutes <= startMinutes) return;
    setSaving(true);
    try {
      await onSave({
        taskId: taskId || null,
        description,
        loggedForUserId: loggedForUserId || undefined,
        entryDate,
        startTime: buildLocalDateTime(entryDate, startMinutes),
        endTime: buildLocalDateTime(entryDate, endMinutes),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Log time" onClose={onClose}>
      <TimeEntryFields entryDate={entryDate} onEntryDateChange={setEntryDate} startMinutes={startMinutes} onStartMinutesChange={setStartMinutes} endMinutes={endMinutes} onEndMinutesChange={setEndMinutes} todayStr={todayStr()} />
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Task (optional)</label>
      <select className="input mb-3" style={fieldStyle} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
        <option value="">No specific task</option>
        {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>
      {isAdmin && (
        <>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Logged for</label>
          <select className="input mb-3" style={fieldStyle} value={loggedForUserId} onChange={(e) => setLoggedForUserId(e.target.value)}>
            <option value="">Myself</option>
            {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
        </>
      )}
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Description</label>
      <textarea className="input mb-4 resize-y" style={{ ...fieldStyle, minHeight: '60px' }} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>Cancel</button>
        <button onClick={save} disabled={saving || endMinutes <= startMinutes} className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: BLUE }}>
          {saving ? 'Saving…' : 'Save time entry'}
        </button>
      </div>
    </Modal>
  );
}
