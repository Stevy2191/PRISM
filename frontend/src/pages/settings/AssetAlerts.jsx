import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import SettingsPage from '../../components/settings/SettingsPage';
import SaveBar, { isDirty } from '../../components/settings/SaveBar';

const FIELDS = [
  { key: 'subscriptionAlertDays', settingsKey: 'assets.subscriptionAlertDays', label: 'Asset subscription renewal', desc: 'Days before a subscription renewal date to create a reminder ticket.', defaultValue: 30 },
  { key: 'warrantyAlertDays', settingsKey: 'assets.warrantyAlertDays', label: 'Asset warranty expiry', desc: 'Days before a warranty expiry date to create a reminder ticket.', defaultValue: 90 },
  { key: 'replacementAlertDays', settingsKey: 'assets.replacementAlertDays', label: 'Asset replacement plan', desc: 'Days before a planned replacement date to create a reminder ticket.', defaultValue: 90 },
  { key: 'licenseExpiryAlertDays', settingsKey: 'licenses.expiryAlertDays', label: 'License expiry', desc: 'Days before a software license expires to create a reminder ticket.', defaultValue: 30 },
  { key: 'contractRenewalAlertDays', settingsKey: 'contracts.renewalAlertDays', label: 'Contract renewal', desc: 'Days before a vendor contract renews (or ends, if no renewal date is set) to create a reminder ticket.', defaultValue: 60 },
];

export default function AssetAlerts() {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [snapshot, setSnapshot] = useState(null); // as loaded or last saved

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => {
        const s = data.settings;
        const f = {};
        FIELDS.forEach((field) => { f[field.key] = Number(s[field.settingsKey]) || field.defaultValue; });
        setForm(f);
        setSnapshot(f);
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const settings = {};
      FIELDS.forEach((field) => { settings[field.settingsKey] = String(form[field.key]); });
      await api.put('/settings', { settings });
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
    <SettingsPage description="Each threshold below controls how many days in advance a reminder ticket is automatically created for that type of expiring item. A ticket is only created once per date (or once per record for licenses/contracts, re-created only after the previous reminder ticket is closed) — see the scheduled job that checks these every 15 minutes.">
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <form onSubmit={save} className="card space-y-5 p-5">
        {FIELDS.map((field) => (
          <div key={field.key} className="border-b border-navy-100 pb-4 last:border-0 last:pb-0">
            <label className="label">{field.label}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="365"
                className="input max-w-[8rem]"
                value={form[field.key]}
                onChange={(e) => { setSaved(false); setForm((f) => ({ ...f, [field.key]: e.target.value })); }}
              />
              <span className="text-sm text-navy-500">days before</span>
            </div>
            <p className="mt-1 text-xs text-navy-400">{field.desc}</p>
          </div>
        ))}

        <SaveBar dirty={isDirty(form, snapshot)} saving={saving} saved={saved} />
      </form>
    </SettingsPage>
  );
}
