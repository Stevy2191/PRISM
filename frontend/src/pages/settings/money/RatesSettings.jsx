// Settings → Money → Rates and billing rules (Phase 3): the hourly rate,
// after hours, the trip charge, the minimum and the step for calls.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../../api/api';
import Spinner from '../../../components/Spinner';
import Notice from '../../../components/ui/Notice';
import SettingsPage, { SettingsPanel } from '../../../components/settings/SettingsPage';

const FIELDS = [
  ['hourlyRate', 'Hourly rate ($)', 'decimal'],
  ['afterHoursRate', 'After-hours rate ($)', 'decimal'],
  ['tripCharge', 'Trip charge per on-site visit ($)', 'decimal'],
  ['eventMinimumMinutes', 'Minimum for an on-site call (minutes)', 'numeric'],
  ['stepMinutes', 'Billed in steps of (minutes)', 'numeric'],
];

export default function RatesSettings() {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api.get('/money/rates').then(({ data }) => setForm(Object.fromEntries(FIELDS.map(([k]) => [k, String(data.rates[k])]))))
      .catch(() => setForm(Object.fromEntries(FIELDS.map(([k]) => [k, '']))));
  }, []);
  const save = async (e) => {
    e.preventDefault();
    setError(''); setSaved(false);
    try {
      const body = { ...form, eventMinimumMinutes: Number(form.eventMinimumMinutes), stepMinutes: Number(form.stepMinutes) };
      const { data } = await api.put('/money/rates', body);
      setForm(Object.fromEntries(FIELDS.map(([k]) => [k, String(data.rates[k])])));
      setSaved(true);
    } catch (err) { setError(errMessage(err)); }
  };
  if (!form) return <Spinner />;
  return (
    <SettingsPage>
      {error && <Notice tone="bad">{error}</Notice>}
      {saved && <Notice tone="info">Rates saved.</Notice>}
      <SettingsPanel title="Rates" description="Customers without an agreement: an on-site call is the trip charge plus at least the minimum, then steps; remote work in steps. Customers with an agreement pay the trip charge only, and after-hours work at the after-hours rate. A customer can have its own rates on its Billing tab.">
        <form className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2" onSubmit={save}>
          {FIELDS.map(([key, label, mode]) => (
            <label key={key} className="text-sm">{label}
              <input className="input mt-1" inputMode={mode} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
            </label>
          ))}
          <div className="sm:col-span-2"><button type="submit" className="btn-primary">Save rates</button></div>
        </form>
      </SettingsPanel>
    </SettingsPage>
  );
}
