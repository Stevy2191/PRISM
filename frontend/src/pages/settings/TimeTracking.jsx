import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import SettingsPage, { SettingsPanel, SettingsRow } from '../../components/settings/SettingsPage';
import SaveBar, { isDirty } from '../../components/settings/SaveBar';


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
    <SettingsPage description="For everyone on the help desk. How each person's timer runs is their own choice, in their Preferences.">
      {error && <div role="alert" className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <form onSubmit={save} className="space-y-5">
        <SettingsPanel title="Time entries">
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

        <SaveBar dirty={isDirty(form, snapshot)} saving={saving} saved={saved} />
      </form>
    </SettingsPage>
  );
}
