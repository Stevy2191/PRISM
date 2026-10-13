import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import SettingsPage from '../../components/settings/SettingsPage';
import SaveBar, { isDirty } from '../../components/settings/SaveBar';

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
  const [saved, setSaved] = useState(false);
  const [snapshot, setSnapshot] = useState(null); // as loaded or last saved

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => {
        let list;
        try {
          list = JSON.parse(data.settings['notifications.enabledTypes']);
        } catch {
          list = TYPES.map(([key]) => key);
        }
        const initial = new Set(Array.isArray(list) ? list : TYPES.map(([key]) => key));
        setEnabled(initial);
        setSnapshot([...initial].sort());
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (key) => { setSaved(false); setEnabled((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  }); };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.put('/settings', { settings: { 'notifications.enabledTypes': [...enabled] } });
      setSnapshot([...enabled].sort());
      setSaved(true);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !enabled) return <Spinner />;

  return (
    <SettingsPage description="System-wide switches for which events create an in-app notification. Turning an event off here stops it for everyone, not just you.">
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
        <div className="p-4">
          <SaveBar dirty={isDirty([...enabled].sort(), snapshot)} saving={saving} saved={saved} />
        </div>
      </form>
    </SettingsPage>
  );
}
