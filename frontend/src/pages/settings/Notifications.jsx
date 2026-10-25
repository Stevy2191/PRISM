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
  ['sla_warning', 'SLA at risk', 'A ticket you’re assigned (or your team, before it’s assigned) is close to an SLA target.'],
  ['sla_breached', 'SLA breached', 'A ticket you’re assigned (or your team, before it’s assigned) missed an SLA target.'],
  ['new_in_queue', 'New in team queue', 'A ticket lands in your team’s queue with nobody assigned.'],
  ['task_added', 'Added to a project task', 'Someone adds you as a helper on a project task.'],
  ['task_unblocked', 'Project task ready to start', 'A task you are on stops waiting on another task.'],
  ['budget_warning', 'Project budget warning', 'A project you work on is close to its hour budget.'],
  ['budget_reached', 'Project budget reached', 'A project you work on has used its hour budget.'],
];

// Events that can also email; users can change their own (Preferences).
const EMAIL_DEFAULTS = {
  assigned: true, comment: true, new_in_queue: true, sla_warning: true, sla_breached: true, watcher_update: false,
  task_added: true, task_unblocked: false, budget_warning: true, budget_reached: true,
};

export default function Notifications() {
  const [enabled, setEnabled] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [snapshot, setSnapshot] = useState(null); // as loaded or last saved
  const [emailDefaults, setEmailDefaults] = useState(EMAIL_DEFAULTS);
  const [emailSnapshot, setEmailSnapshot] = useState(EMAIL_DEFAULTS);

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
        let defaults = {};
        try { defaults = JSON.parse(data.settings['notifications.emailDefaults']) || {}; } catch { defaults = {}; }
        const merged = { ...EMAIL_DEFAULTS, ...defaults };
        setEmailDefaults(merged);
        setEmailSnapshot(merged);
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
      await api.put('/settings', { settings: { 'notifications.enabledTypes': [...enabled], 'notifications.emailDefaults': emailDefaults } });
      setSnapshot([...enabled].sort());
      setEmailSnapshot(emailDefaults);
      setSaved(true);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !enabled) return <Spinner />;

  return (
    <SettingsPage description="System-wide switches for which events create a notification. Turning an event off here stops it for everyone, not just you. Some events can also email; this sets the default, and each person can change theirs in Preferences.">
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <form onSubmit={save} className="card divide-y divide-navy-100">
        {TYPES.map(([key, label, desc]) => (
          <div key={key} className="flex items-start justify-between gap-3 p-4">
            <div>
              <p className="font-medium text-navy-900">{label}</p>
              <p className="text-sm text-navy-500">{desc}</p>
            </div>
            <div className="flex flex-shrink-0 flex-col items-end gap-1 text-sm text-navy-700">
              <label className="flex cursor-pointer items-center gap-2">
                On
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-navy-300 text-prism"
                  checked={enabled.has(key)}
                  onChange={() => toggle(key)}
                  aria-label={`${label}: on`}
                />
              </label>
              {Object.hasOwn(EMAIL_DEFAULTS, key) && (
                <label className="flex cursor-pointer items-center gap-2" title="Email this by default; each person can change it in Preferences">
                  Email by default
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-navy-300 text-prism"
                    checked={!!emailDefaults[key]}
                    disabled={!enabled.has(key)}
                    onChange={(e) => { setSaved(false); setEmailDefaults((d) => ({ ...d, [key]: e.target.checked })); }}
                    aria-label={`${label}: email by default`}
                  />
                </label>
              )}
            </div>
          </div>
        ))}
        <div className="p-4">
          <SaveBar dirty={isDirty([...enabled].sort(), snapshot) || isDirty(emailDefaults, emailSnapshot)} saving={saving} saved={saved} />
        </div>
      </form>
    </SettingsPage>
  );
}
