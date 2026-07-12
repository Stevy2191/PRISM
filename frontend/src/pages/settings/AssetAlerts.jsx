import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';

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
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => {
        const s = data.settings;
        const f = {};
        FIELDS.forEach((field) => { f[field.key] = Number(s[field.settingsKey]) || field.defaultValue; });
        setForm(f);
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
      <h1 className="text-2xl font-bold text-navy-900">Asset Alerts</h1>
      <p className="text-sm text-navy-500">
        Each threshold below controls how many days in advance a reminder ticket is automatically created for that
        type of expiring item. A ticket is only created once per date (or once per record for licenses/contracts,
        re-created only after the previous reminder ticket is closed) — see the scheduled job that checks these
        every 15 minutes.
      </p>
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
                onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
              />
              <span className="text-sm text-navy-500">days before</span>
            </div>
            <p className="mt-1 text-xs text-navy-400">{field.desc}</p>
          </div>
        ))}

        <div className="flex items-center justify-end gap-3">
          {savedAt && <span className="text-sm text-green-600">Saved</span>}
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
