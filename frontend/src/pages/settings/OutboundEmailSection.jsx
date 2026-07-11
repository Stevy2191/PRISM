import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';

const fieldStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)' };

const EMPTY_FORM = {
  host: '', port: 587, ssl: true, username: '', password: '', fromName: '', fromEmail: '',
};

export default function OutboundEmailSection() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [passwordSet, setPasswordSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [sendingTest, setSendingTest] = useState(false);

  const load = () => {
    api.get('/settings/smtp')
      .then(({ data }) => {
        setForm({
          host: data.host, port: data.port, ssl: data.ssl, username: data.username,
          password: '', fromName: data.fromName, fromEmail: data.fromEmail,
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
      await api.patch('/settings/smtp', form);
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2500);
      load();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const sendTestEmail = async () => {
    setSendingTest(true);
    setTestResult(null);
    try {
      const { data } = await api.post('/settings/smtp/test', { ...form, sendTest: true });
      setTestResult(data);
    } catch (err) {
      setTestResult({ success: false, message: errMessage(err) });
    } finally {
      setSendingTest(false);
    }
  };

  if (loading) return <div className="card p-5 text-sm text-navy-400">Loading outbound email settings…</div>;

  return (
    <div className="card space-y-5 p-5">
      <div className="border-b border-navy-100 pb-4">
        <h2 className="font-semibold text-navy-900">Outbound Email (SMTP)</h2>
        <p className="mt-1 text-xs text-navy-400">
          Used to send auto-reply acknowledgements and tech replies as emails to contacts.
        </p>
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
            <label className="label">SMTP host</label>
            <input className="input" style={fieldStyle} value={form.host} onChange={set('host')} placeholder="smtp.company.com" />
          </div>
          <div>
            <label className="label">SMTP port</label>
            <input type="number" className="input" style={fieldStyle} value={form.port} onChange={set('port')} />
          </div>
          <div>
            <label className="label">Username</label>
            <input className="input" style={fieldStyle} value={form.username} onChange={set('username')} />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password" className="input" style={fieldStyle} value={form.password} onChange={set('password')}
              placeholder={passwordSet ? '••••••••' : 'Not set'} autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">From name</label>
            <input className="input" style={fieldStyle} value={form.fromName} onChange={set('fromName')} placeholder="PRISM Helpdesk" />
          </div>
          <div>
            <label className="label">From email address</label>
            <input type="email" className="input" style={fieldStyle} value={form.fromEmail} onChange={set('fromEmail')} placeholder="helpdesk@company.com" />
          </div>
        </div>

        <label className="flex h-9 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={form.ssl} onChange={set('ssl')} className="h-4 w-4 rounded border-navy-300 text-prism" />
          <span className="text-sm text-navy-700">Use SSL/TLS</span>
        </label>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-navy-100 pt-4">
          {savedAt && <span className="text-sm text-green-600">Saved</span>}
          <button type="button" className="btn-secondary" onClick={sendTestEmail} disabled={sendingTest}>
            {sendingTest ? 'Sending…' : 'Send test email'}
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
