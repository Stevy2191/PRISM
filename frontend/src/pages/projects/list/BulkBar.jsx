// Change status, reassign the lead or close, for the checked projects.
import { useState } from 'react';
import api, { errMessage } from '../../../api/api';
import Button from '../../../components/ui/Button';

export default function BulkBar({ ids, statuses, users, onClear, onDone }) {
  const [action, setAction] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closed = statuses.find((s) => s.behaviorType === 'closed');

  const apply = async () => {
    const body = action === 'status' ? { status: value } : action === 'lead' ? { assignedToUserId: value } : { status: closed?.name };
    setBusy(true);
    setError('');
    try {
      await Promise.all(ids.map((id) => api.patch(`/projects/${id}`, body)));
      onDone();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 text-sm" style={{ backgroundColor: 'var(--color-accent-soft)', borderColor: 'color-mix(in srgb, var(--color-accent) 35%, transparent)' }}>
      <b>{ids.length} selected</b>
      <select aria-label="Action" className="input h-9 text-sm" value={action} onChange={(e) => { setAction(e.target.value); setValue(''); }}>
        <option value="">Choose action…</option>
        <option value="status">Change status</option>
        <option value="lead">Reassign lead</option>
        <option value="close">Close selected</option>
      </select>
      {action === 'status' && (
        <select aria-label="Status" className="input h-9 text-sm" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Select status…</option>
          {statuses.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
      )}
      {action === 'lead' && (
        <select aria-label="Lead" className="input h-9 text-sm" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Select lead…</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
        </select>
      )}
      <Button size="sm" variant="primary" disabled={busy || !action || (action !== 'close' && !value) || (action === 'close' && !closed)} onClick={apply}>Apply</Button>
      <Button size="sm" variant="quiet" onClick={onClear} className="ml-auto">Clear selection</Button>
      {error && <span role="alert" style={{ color: 'var(--color-danger)' }}>{error}</span>}
    </div>
  );
}
