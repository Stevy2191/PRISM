import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';

// The callback URLs an admin must register with Google/Microsoft — computed
// from the current origin since this backend is deployed same-origin by
// default (see backend calendarIntegrationsController.js's callbackUrl()).
const GOOGLE_REDIRECT_URI = `${window.location.origin}/api/v1/calendar/integrations/google/callback`;
const MICROSOFT_REDIRECT_URI = `${window.location.origin}/api/v1/calendar/integrations/microsoft/callback`;

function CopyableField({ value }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 truncate rounded-md bg-navy-50 px-3 py-1.5 text-xs text-navy-700">{value}</code>
      <button type="button" onClick={copy} className="btn-secondary text-xs">{copied ? 'Copied!' : 'Copy'}</button>
    </div>
  );
}

export default function CalendarIntegration() {
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
          googleClientId: s['integrations.googleClientId'] || '',
          googleClientSecret: '',
          googleClientSecretSet: !!s['integrations.googleClientSecretSet'],
          microsoftClientId: s['integrations.microsoftClientId'] || '',
          microsoftClientSecret: '',
          microsoftClientSecretSet: !!s['integrations.microsoftClientSecretSet'],
          microsoftTenantId: s['integrations.microsoftTenantId'] || '',
        });
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      // Blank secret fields mean "leave unchanged" — the GET above never
      // sent the real secret back, so this never accidentally wipes it.
      await api.put('/settings', {
        settings: {
          'integrations.googleClientId': form.googleClientId,
          'integrations.googleClientSecret': form.googleClientSecret,
          'integrations.microsoftClientId': form.microsoftClientId,
          'integrations.microsoftClientSecret': form.microsoftClientSecret,
          'integrations.microsoftTenantId': form.microsoftTenantId,
        },
      });
      const { data } = await api.get('/settings');
      setForm((f) => ({
        ...f,
        googleClientSecret: '',
        googleClientSecretSet: !!data.settings['integrations.googleClientSecretSet'],
        microsoftClientSecret: '',
        microsoftClientSecretSet: !!data.settings['integrations.microsoftClientSecretSet'],
      }));
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
      <h1 className="text-2xl font-bold text-navy-900">Calendar Integration</h1>
      <p className="text-sm text-navy-500">
        OAuth app credentials for the Google Calendar / Microsoft Outlook connect buttons on the Calendar
        page (Account Preferences → Calendar integrations). Without these configured here, users can still
        connect an iCal/CalDAV URL, but the Google/Microsoft options stay disabled.
      </p>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <form onSubmit={save} className="space-y-5">
        <div className="card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-navy-900">Google Calendar</h2>
            {form.googleClientSecretSet
              ? <span className="badge bg-green-100 text-green-800">Configured</span>
              : <span className="badge bg-navy-100 text-navy-500">Not configured</span>}
          </div>
          <div className="rounded-md bg-navy-50 p-3 text-xs text-navy-500">
            <p className="mb-1 font-medium text-navy-700">Setup instructions</p>
            <ol className="list-inside list-decimal space-y-0.5">
              <li>Create OAuth 2.0 credentials at <span className="font-medium">console.cloud.google.com</span> (APIs &amp; Services → Credentials → OAuth Client ID, type: Web application).</li>
              <li>Add the redirect URI below to "Authorized redirect URIs".</li>
              <li>Enable the <span className="font-medium">Google Calendar API</span> for the project.</li>
              <li>Paste the generated Client ID and Client Secret below.</li>
            </ol>
            <p className="mb-1 mt-2 font-medium text-navy-700">Authorized redirect URI</p>
            <CopyableField value={GOOGLE_REDIRECT_URI} />
          </div>
          <div>
            <label className="label">Client ID</label>
            <input className="input" value={form.googleClientId} onChange={set('googleClientId')} />
          </div>
          <div>
            <label className="label">Client Secret</label>
            <input
              type="password"
              className="input"
              value={form.googleClientSecret}
              onChange={set('googleClientSecret')}
              placeholder={form.googleClientSecretSet ? '•••••••••••••• (unchanged)' : 'Not set'}
              autoComplete="new-password"
            />
          </div>
        </div>

        <div className="card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-navy-900">Microsoft Outlook / Office 365</h2>
            {form.microsoftClientSecretSet
              ? <span className="badge bg-green-100 text-green-800">Configured</span>
              : <span className="badge bg-navy-100 text-navy-500">Not configured</span>}
          </div>
          <div className="rounded-md bg-navy-50 p-3 text-xs text-navy-500">
            <p className="mb-1 font-medium text-navy-700">Setup instructions</p>
            <ol className="list-inside list-decimal space-y-0.5">
              <li>Register an app at <span className="font-medium">portal.azure.com</span> (Azure Active Directory → App registrations → New registration, Web platform).</li>
              <li>Add the redirect URI below under Authentication.</li>
              <li>Under Certificates &amp; secrets, create a new client secret.</li>
              <li>Under API permissions, add Microsoft Graph delegated permissions: <span className="font-medium">Calendars.ReadWrite</span>, <span className="font-medium">offline_access</span>, <span className="font-medium">User.Read</span>.</li>
              <li>Paste the Application (client) ID, the client secret, and your Directory (tenant) ID below.</li>
            </ol>
            <p className="mb-1 mt-2 font-medium text-navy-700">Redirect URI</p>
            <CopyableField value={MICROSOFT_REDIRECT_URI} />
          </div>
          <div>
            <label className="label">Client ID</label>
            <input className="input" value={form.microsoftClientId} onChange={set('microsoftClientId')} />
          </div>
          <div>
            <label className="label">Client Secret</label>
            <input
              type="password"
              className="input"
              value={form.microsoftClientSecret}
              onChange={set('microsoftClientSecret')}
              placeholder={form.microsoftClientSecretSet ? '•••••••••••••• (unchanged)' : 'Not set'}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">Tenant ID</label>
            <input className="input" value={form.microsoftTenantId} onChange={set('microsoftTenantId')} placeholder="common (or your directory/tenant ID)" />
            <p className="mt-1 text-xs text-navy-400">Leave as "common" to allow sign-in from any Microsoft account, or set your organization's tenant ID to restrict it.</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {savedAt && <span className="text-sm text-green-600">Saved</span>}
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
