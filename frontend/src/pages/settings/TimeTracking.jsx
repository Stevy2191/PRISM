import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import SettingsPage, { SettingsPanel, SettingsRow } from '../../components/settings/SettingsPage';
import SaveBar, { isDirty } from '../../components/settings/SaveBar';

const THRESHOLDS = [0, 60, 120, 300, 600, 900]; // seconds

export default function TimeTracking() {
  const [form, setForm] = useState(null);
  const [snapshot, setSnapshot] = useState(null); // as loaded or last saved
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => {
        const s = data.settings;
        const loaded = {
          defaultMode: s['timeTracking.defaultMode'] || 'manual',
          defaultMinThreshold: Number(s['timeTracking.defaultMinThreshold']) || 0,
          requireBeforeClose: s['timeTracking.requireBeforeClose'] === 'true',
          maxEntryHours: Number(s['timeTracking.maxEntryHours']) || 12,
        };
        setForm(loaded);
        setSnapshot(loaded);
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const set = (patch) => { setSaved(false); setForm((f) => ({ ...f, ...patch })); };

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
          'timeTracking.maxEntryHours': String(form.maxEntryHours),
        },
      });
      setSnapshot(form);
      setSaved(true);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) return <Spinner />;

  return (
    <SettingsPage description="Defaults for logging time, for everyone. People can change their own timer mode and minimum in Preferences.">
      {error && <div role="alert" className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <form onSubmit={save} className="space-y-5">
        <SettingsPanel title="Timer">
          <SettingsRow label="Timer mode for new users" htmlFor="defaultMode">
            <select id="defaultMode" className="input" value={form.defaultMode} onChange={(e) => set({ defaultMode: e.target.value })}>
              <option value="manual">Manual — start and stop the timer yourself</option>
              <option value="automatic">Automatic — the timer runs while a ticket is open</option>
            </select>
          </SettingsRow>
          <SettingsRow label="Minimum entry for new users" htmlFor="defaultMinThreshold" help="New users are warned before logging a timer session shorter than this.">
            <select id="defaultMinThreshold" className="input" value={form.defaultMinThreshold}
              onChange={(e) => set({ defaultMinThreshold: Number(e.target.value) })}>
              {THRESHOLDS.map((s) => (
                <option key={s} value={s}>{s === 0 ? 'No minimum' : `${s / 60} minute${s / 60 === 1 ? '' : 's'}`}</option>
              ))}
            </select>
          </SettingsRow>
          <SettingsRow label="Longest time entry" htmlFor="maxEntryHours"
            help="No one entry can be longer. A timer stops counting when it gets there, so one left running overnight or over a weekend logs this much at most, and the person corrects it when they stop it.">
            <select id="maxEntryHours" className="input" value={form.maxEntryHours}
              onChange={(e) => set({ maxEntryHours: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>{h} hour{h === 1 ? '' : 's'}</option>
              ))}
            </select>
          </SettingsRow>
        </SettingsPanel>

        <SettingsPanel title="Closing tickets">
          <SettingsRow label="Require time before closing" htmlFor="requireBeforeClose"
            help="A ticket can't move to a closed status until at least one time entry is logged on it.">
            <input type="checkbox" id="requireBeforeClose" className="mt-1 h-4 w-4 rounded border-navy-300 text-prism"
              checked={form.requireBeforeClose} onChange={(e) => set({ requireBeforeClose: e.target.checked })} />
          </SettingsRow>
        </SettingsPanel>

        <SaveBar dirty={isDirty(form, snapshot)} saving={saving} saved={saved} />
      </form>
    </SettingsPage>
  );
}
