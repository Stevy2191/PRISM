// Time Entries tab.
import { useState } from 'react';
import { errMessage } from '../../../api/api';
import {
  CARD_BG,
  BORDER,
  TEXT,
  MUTED,
  BLUE,
  formatMinutes,
  formatDate,
  buildLocalDateTime,
  fieldStyle,
} from '../theme';
import { Modal } from './Modal';
import { TimeEntryFields, LoggedForField } from './TimeFields';

function formatCost(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function roundDownTo5(date) {
  const mins = date.getHours() * 60 + date.getMinutes();
  return mins - (mins % 5);
}

// ---- Time entries tab ----

export function TimeEntriesTab({ entries, totalMinutes, onAdd, assignableUsers, canLogTimeForOthers, currentUser }) {
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
                <div className="flex flex-col items-end gap-0.5">
                  <span className="font-mono text-sm font-semibold" style={{ color: 'var(--color-success)' }}>{formatMinutes(displayMinutes)}</span>
                  {e.laborCost != null && (
                    <span className="text-xs" style={{ color: MUTED }}>{formatCost(e.laborCost)}</span>
                  )}
                </div>
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
