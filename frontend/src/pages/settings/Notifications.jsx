import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';

const TYPES = [
  ['assigned', 'Ticket assigned', 'A ticket is assigned to you.'],
  ['comment', 'Comment added', 'Someone comments on a ticket assigned to you.'],
  ['reply', 'Reply received', 'A contact replies on one of your tickets.'],
  ['overdue', 'Ticket overdue', 'One of your assigned tickets passes its due date.'],
  ['due_soon', 'Due date approaching', 'One of your assigned tickets is due soon.'],
  ['status_change', 'Status changed', 'A ticket you’re watching changes status.'],
  ['watcher_update', 'Watched ticket updated', 'Activity on a ticket you’re watching.'],
  ['workflow', 'Workflow rule notification', 'A workflow rule’s "notify" action fires.'],
];

export default function Notifications() {
  const [enabled, setEnabled] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => {
        let list;
        try {
          list = JSON.parse(data.settings['notifications.enabledTypes']);
        } catch {
          list = TYPES.map(([key]) => key);
        }
        setEnabled(new Set(Array.isArray(list) ? list : TYPES.map(([key]) => key)));
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (key) => setEnabled((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.put('/settings', { settings: { 'notifications.enabledTypes': [...enabled] } });
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2500);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !enabled) return <Spinner />;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Notifications</h1>
        <p className="text-sm text-navy-500">
          System-wide switches for which events create an in-app notification. Turning an event off
          here stops it for everyone, not just you.
        </p>
      </div>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <form onSubmit={save} className="card divide-y divide-navy-100">
        {TYPES.map(([key, label, desc]) => (
          <label key={key} className="flex cursor-pointer items-start justify-between gap-3 p-4">
            <div>
              <p className="font-medium text-navy-900">{label}</p>
              <p className="text-sm text-navy-500">{desc}</p>
            </div>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 flex-shrink-0 rounded border-navy-300 text-prism"
              checked={enabled.has(key)}
              onChange={() => toggle(key)}
            />
          </label>
        ))}
        <div className="flex items-center justify-end gap-3 p-4">
          {savedAt && <span className="text-sm text-green-600">Saved</span>}
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
