import { useState } from 'react';
import api, { errMessage } from '../../../api/api';
import TimeDropdownPicker from '../../../components/TimeDropdownPicker';
import { Modal } from './Modal';
import { MUTED } from '../theme';

// Moves a ticket's SLA due date (POST /tickets/:id/due-date). "extend":
// later only, reason required — what every technician can do. "change":
// for users with Adjust SLA due dates, any date, reason optional. The
// server enforces the same rules. Dates are in the organization's time
// zone, like the ticket's dueDate/dueTime.
export default function DueDateModal({ ticket, mode, onClose, onSaved }) {
  const [date, setDate] = useState(ticket.dueDate || '');
  const [time, setTime] = useState(ticket.dueTime ? ticket.dueTime.slice(0, 5) : '17:00');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const extend = mode === 'extend';
  const current = `${ticket.dueDate || ''} ${ticket.dueTime ? ticket.dueTime.slice(0, 5) : ''}`;
  const chosen = `${date} ${time || ''}`;
  const later = chosen > current;

  let problem = '';
  if (!date || !time) problem = 'Pick a date and time.';
  else if (chosen === current) problem = 'That is already the due date.';
  else if (extend && !later) problem = 'An extension must be later than the current due date.';
  else if (extend && !reason.trim()) problem = 'Say why the due date is being extended.';

  const save = async (e) => {
    e.preventDefault();
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post(`/tickets/${ticket.id}/due-date`, { dueDate: date, dueTime: time, reason: reason.trim() || null });
      onSaved(data.ticket);
    } catch (err) {
      setError(errMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal title={extend ? 'Extend due date' : 'Change due date'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-xs" style={{ color: MUTED }}>Current due date: {current.trim() || 'none'}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="due-date-input">New due date</label>
            <input id="due-date-input" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <span className="label">Time</span>
            <TimeDropdownPicker value={time} onChange={setTime} selectClassName="input h-10 text-sm" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="due-date-reason">Reason{extend ? '' : ' (optional)'}</label>
          <textarea id="due-date-reason" className="input min-h-[80px]" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : (extend ? 'Extend' : 'Save')}</button>
        </div>
      </form>
    </Modal>
  );
}
