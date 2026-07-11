import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';

const fieldStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)' };
const POLL_INTERVALS = [[1, 'Every 1 min'], [2, 'Every 2 min'], [5, 'Every 5 min'], [10, 'Every 10 min']];

const EMPTY_FORM = {
  enabled: false, host: '', port: 993, ssl: true, address: '', username: '', password: '', pollInterval: 5,
};

export default function InboundEmailSection() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [passwordSet, setPasswordSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const load = () => {
    api.get('/settings/inbound-email')
      .then(({ data }) => {
        setForm({
          enabled: data.enabled, host: data.host, port: data.port, ssl: data.ssl,
          address: data.address, username: data.username, password: '', pollInterval: data.pollInterval,
        });
        setPasswordSet(data.password === '***');
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.patch('/settings/inbound-email', form);
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2500);
      load();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post('/settings/inbound-email/test', form);
      setTestResult(data);
    } catch (err) {
      setTestResult({ success: false, message: errMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <div className="card p-5 text-sm text-navy-400">Loading inbound email settings…</div>;

  return (
    <div className="card space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-100 pb-4">
        <div>
          <h2 className="font-semibold text-navy-900">Inbound Email</h2>
          <p className="mt-1 text-xs text-navy-400">
            Turns incoming emails to your helpdesk address into tickets automatically (polling method: IMAP).
          </p>
        </div>
        <label className="flex h-9 flex-shrink-0 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={form.enabled} onChange={set('enabled')} className="h-4 w-4 rounded border-navy-300 text-prism" />
          <span className="text-sm font-medium text-navy-700">{form.enabled ? 'Enabled' : 'Disabled'}</span>
        </label>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {testResult && (
        <div className={`rounded-md p-3 text-sm ${testResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
          {testResult.message}
        </div>
      )}

      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">IMAP server hostname</label>
            <input className="input" style={fieldStyle} value={form.host} onChange={set('host')} placeholder="imap.company.com" />
          </div>
          <div>
            <label className="label">IMAP port</label>
            <input type="number" className="input" style={fieldStyle} value={form.port} onChange={set('port')} />
          </div>
          <div>
            <label className="label">Email address</label>
            <input type="email" className="input" style={fieldStyle} value={form.address} onChange={set('address')} placeholder="helpdesk@company.com" />
          </div>
          <div>
            <label className="label">Username</label>
            <input className="input" style={fieldStyle} value={form.username} onChange={set('username')} placeholder="Usually the same as the email address" />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password" className="input" style={fieldStyle} value={form.password} onChange={set('password')}
              placeholder={passwordSet ? '••••••••' : 'Not set'} autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">Poll interval</label>
            <select className="input" style={fieldStyle} value={form.pollInterval} onChange={(e) => setForm((f) => ({ ...f, pollInterval: Number(e.target.value) }))}>
              {POLL_INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        <label className="flex h-9 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={form.ssl} onChange={set('ssl')} className="h-4 w-4 rounded border-navy-300 text-prism" />
          <span className="text-sm text-navy-700">Use SSL</span>
        </label>

        <div className="flex items-center justify-end gap-3 border-t border-navy-100 pt-4">
          {savedAt && <span className="text-sm text-green-600">Saved</span>}
          <button type="button" className="btn-secondary" onClick={test} disabled={testing}>{testing ? 'Testing…' : 'Test connection'}</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
