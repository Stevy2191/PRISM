import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import Spinner from '../components/Spinner';
import LdapSection from './settings/LdapSection';

const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];

function Row({ label, value }) {
  return (
    <div className="flex justify-between border-b border-navy-100 py-2 text-sm last:border-0">
      <span className="text-navy-500">{label}</span>
      <span className="font-mono text-navy-800">{value ?? '—'}</span>
    </div>
  );
}

function Bool({ value }) {
  return (
    <span className={value ? 'font-medium text-green-600' : 'font-medium text-red-500'}>
      {value ? 'set' : 'not set'}
    </span>
  );
}

export default function AdminSettings() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => {
        setConfig(data.config);
        setForm({
          inboundEmailAddress: data.settings['system.inboundEmailAddress'] || '',
          maxAttachmentSizeMB: data.settings['system.maxAttachmentSizeMB'] || '25',
          timezone: data.settings['company.timezone'] || 'UTC',
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
          'system.inboundEmailAddress': form.inboundEmailAddress,
          'system.maxAttachmentSizeMB': String(form.maxAttachmentSizeMB),
          'company.timezone': form.timezone,
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
  if (error && !config) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;

  return (
    <div className="max-w-3xl space-y-6">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div>
        <h1 className="text-2xl font-bold text-navy-900">General Settings</h1>
        <p className="text-sm text-navy-500">System-level configuration.</p>
      </div>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <LdapSection />

      <form onSubmit={save} className="card space-y-4 p-5">
        <h2 className="font-semibold text-navy-900">System</h2>

        <div>
          <label className="label">System timezone</label>
          <select className="input max-w-xs" value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}>
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
          <p className="mt-1 text-xs text-navy-400">Same value as Company → Timezone — editing it here updates that too.</p>
        </div>

        <div>
          <label className="label">Inbound email address</label>
          <input
            type="email" className="input max-w-sm" placeholder="support@yourcompany.com"
            value={form.inboundEmailAddress}
            onChange={(e) => setForm((f) => ({ ...f, inboundEmailAddress: e.target.value }))}
          />
          <p className="mt-1 text-xs text-navy-400">
            The address email-to-ticket would forward from. Stored for future use — PRISM doesn't
            yet have an inbound email processor, so nothing is created from this address today.
          </p>
        </div>

        <div>
          <label className="label">Max attachment size (MB)</label>
          <input
            type="number" min="1" max="100" className="input max-w-[8rem]"
            value={form.maxAttachmentSizeMB}
            onChange={(e) => setForm((f) => ({ ...f, maxAttachmentSizeMB: e.target.value }))}
          />
          <p className="mt-1 text-xs text-navy-400">Applies to ticket and project file uploads. Hard ceiling is 100MB.</p>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-navy-100 pt-4">
          {savedAt && <span className="text-sm text-green-600">Saved</span>}
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-navy-900">Database</h2>
        <Row label="Host" value={config.database.host} />
        <Row label="Port" value={config.database.port} />
        <Row label="Name" value={config.database.name} />
        <Row label="User" value={config.database.user} />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-navy-900">Application</h2>
        <Row label="Environment" value={config.app.nodeEnv} />
        <div className="flex justify-between py-2 text-sm">
          <span className="text-navy-500">Session secret</span>
          <Bool value={config.app.sessionSecretSet} />
        </div>
      </div>
    </div>
  );
}
