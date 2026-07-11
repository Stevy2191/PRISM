import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';

const THRESHOLDS = [0, 60, 120, 300, 600, 900]; // seconds

export default function TimeTracking() {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => {
        const s = data.settings;
        setForm({
          defaultMode: s['timeTracking.defaultMode'] || 'manual',
          defaultMinThreshold: Number(s['timeTracking.defaultMinThreshold']) || 0,
          requireBeforeClose: s['timeTracking.requireBeforeClose'] === 'true',
        });
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.put('/settings', {
        settings: {
          'timeTracking.defaultMode': form.defaultMode,
          'timeTracking.defaultMinThreshold': String(form.defaultMinThreshold),
          'timeTracking.requireBeforeClose': String(form.requireBeforeClose),
        },
      });
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2500);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) return <Spinner />;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <h1 className="text-2xl font-bold text-navy-900">Time Tracking</h1>
      <p className="text-sm text-navy-500">
        System-wide defaults for time logging. Individual users can still override their own
        timer mode and threshold in Account Preferences.
      </p>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <form onSubmit={save} className="card space-y-5 p-5">
        <div>
          <label className="label">Default timer mode for new users</label>
          <select
            className="input max-w-xs"
            value={form.defaultMode}
            onChange={(e) => setForm((f) => ({ ...f, defaultMode: e.target.value }))}
          >
            <option value="manual">Manual — start/stop the timer yourself</option>
            <option value="automatic">Automatic — timer runs while a ticket is open</option>
          </select>
        </div>

        <div>
          <label className="label">Default minimum log threshold</label>
          <select
            className="input max-w-xs"
            value={form.defaultMinThreshold}
            onChange={(e) => setForm((f) => ({ ...f, defaultMinThreshold: Number(e.target.value) }))}
          >
            {THRESHOLDS.map((s) => (
              <option key={s} value={s}>{s === 0 ? 'No minimum' : `${s / 60} minute${s / 60 === 1 ? '' : 's'}`}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-navy-400">
            New users are warned before logging a timer session shorter than this.
          </p>
        </div>

        <div className="flex items-start gap-3 border-t border-navy-100 pt-4">
          <input
            type="checkbox"
            id="requireBeforeClose"
            className="mt-0.5 h-4 w-4 rounded border-navy-300 text-prism"
            checked={form.requireBeforeClose}
            onChange={(e) => setForm((f) => ({ ...f, requireBeforeClose: e.target.checked }))}
          />
          <label htmlFor="requireBeforeClose" className="text-sm text-navy-700">
            <span className="font-medium text-navy-900">Require time logged before closing a ticket</span>
            <br />
            When enabled, a ticket can't be moved to a closed status until at least one time entry has been logged against it.
          </label>
        </div>

        <div className="flex items-center justify-end gap-3">
          {savedAt && <span className="text-sm text-green-600">Saved</span>}
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
