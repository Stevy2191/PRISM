import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Switch from '../../components/Switch';
import SettingsPage from '../../components/settings/SettingsPage';
import Notice from '../../components/ui/Notice';

const MUTED = { color: 'var(--color-text-muted)' };

// The Microsoft 365 app registration (7b): client ID, secret (write-only:
// replaced, never shown), the redirect address to register, and a test
// sign-in. Changing it needs an owner (the server says so if not).
function MicrosoftApp({ settings, onSaved }) {
  const [clientId, setClientId] = useState(settings['portal.msClientId'] || '');
  const [secret, setSecret] = useState('');
  const [replacing, setReplacing] = useState(!settings['portal.msClientSecretSet']);
  const [info, setInfo] = useState(null);
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { api.get('/settings/portal-microsoft').then(({ data }) => setInfo(data)).catch(() => {}); }, []);
  const dirty = clientId.trim() !== (settings['portal.msClientId'] || '') || !!secret.trim();
  const save = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await api.patch('/settings', { 'portal.msClientId': clientId.trim(), 'portal.msClientSecret': secret.trim() });
      setSecret('');
      setReplacing(false);
      onSaved(data.settings || null);
    } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  };
  const runTest = async () => {
    setBusy(true); setError('');
    try { setTest((await api.post('/settings/portal-microsoft/test')).data); } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(info.redirectUri); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };
  let status = 'Not tested';
  if (test) status = test.ok === true ? 'Working' : (test.ok === false ? 'Not working' : 'Nothing to test against');
  return (
    <section aria-label="Microsoft 365 app" className="card divide-y divide-navy-100">
      <div className="p-5">
        <p className="font-medium text-navy-900">Microsoft 365 app</p>
        <p className="text-xs text-navy-400">One app registration serves every company. Each company&apos;s Microsoft 365 admin approves it once, from the company&apos;s Microsoft 365 tab.</p>
        {error && <div className="mt-3"><Notice tone="bad">{error}</Notice></div>}
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center">
        <label htmlFor="ms-client-id" className="text-sm font-medium text-navy-700">Application (client) ID</label>
        <input id="ms-client-id" className="input h-9 min-w-0 font-mono text-sm" value={clientId} onChange={(e) => setClientId(e.target.value)} />
        <label htmlFor="ms-client-secret" className="text-sm font-medium text-navy-700">Client secret</label>
        {replacing ? (
          <input id="ms-client-secret" type="password" autoComplete="off" className="input h-9 min-w-0 text-sm" placeholder="Paste the secret's value" value={secret} onChange={(e) => setSecret(e.target.value)} />
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span style={MUTED}>Stored encrypted.</span>
            <button type="button" onClick={() => setReplacing(true)} className="btn-secondary h-8 px-3 text-sm">Replace</button>
          </div>
        )}
        <span className="text-sm font-medium text-navy-700">Redirect address</span>
        <div className="flex min-w-0 gap-2">
          <input readOnly aria-label="Redirect address" value={info ? info.redirectUri : ''} className="input h-9 min-w-0 flex-1 text-sm" />
          <button type="button" disabled={!info} onClick={copy} className="btn-secondary h-9 flex-shrink-0 px-3 text-sm">{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <span className="text-sm font-medium text-navy-700">Status</span>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span role="status" className="font-medium">{status}</span>
          {test && <span className="break-words" style={MUTED}>{test.message}</span>}
          <button type="button" disabled={busy || dirty} onClick={runTest} className="btn-secondary h-8 px-3 text-sm">Test</button>
        </div>
      </div>
      {dirty && (
        <div className="flex justify-end p-4">
          <button type="button" disabled={busy} onClick={save} className="btn-primary h-9 px-4 text-sm">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}
    </section>
  );
}

// Mockup SettingsPortal: the portal switch and its address, the Microsoft
// 365 app (7b), and who can manage access. The switch saves at once.
export default function ClientPortal() {
  const [enabled, setEnabled] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const address = `${window.location.origin}/portal`;

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => { setEnabled(data.settings['portal.enabled'] === 'true'); setSettings(data.settings); })
      .catch((err) => setError(errMessage(err)));
  }, []);

  const toggle = async (on) => {
    setSaving(true); setError('');
    try {
      await api.patch('/settings', { 'portal.enabled': String(on) });
      setEnabled(on);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };

  if (enabled === null && !error) return <Spinner />;
  return (
    <SettingsPage description="Contacts sign in to the portal to raise and follow tickets and read the knowledge base.">
      {error && <Notice tone="bad">{error}</Notice>}
      <section aria-label="Portal" className="card divide-y divide-navy-100">
        <div className="flex items-center justify-between gap-4 p-5">
          <div>
            <p className="font-medium text-navy-900">Portal on</p>
            <p className="text-xs text-navy-400">{enabled ? 'Contacts with portal access can sign in.' : 'Off: nobody can sign in to the portal.'}</p>
          </div>
          <Switch checked={!!enabled} disabled={saving || enabled === null} onChange={toggle} label="Portal on" />
        </div>
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-navy-900">Portal address</p>
            <p className="text-xs text-navy-400">Give this link to your customers.</p>
          </div>
          <div className="flex min-w-0 gap-2">
            <input readOnly value={address} aria-label="Portal address" className="input h-9 min-w-0 text-sm sm:w-72" />
            <button type="button" onClick={copy} className="btn-secondary h-9 flex-shrink-0 px-3 text-sm">{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      </section>
      {settings && <MicrosoftApp key={settings['portal.msClientId']} settings={settings} onSaved={(next) => next && setSettings(next)} />}
      <section aria-label="Who can manage portal access" className="card p-5">
        <p className="font-medium text-navy-900">Who can manage portal access</p>
        <p className="mt-1 text-sm text-navy-500">
          Granting access, sending invites, setting admins and contact watchers, and linking tenants need the &ldquo;Manage portal access&rdquo; permission:
          administrators, and anyone whose role includes it. Set that in <Link to="/admin/roles" className="font-medium hover:underline" style={{ color: 'var(--color-accent)' }}>Roles &amp; permissions</Link>.
        </p>
      </section>
    </SettingsPage>
  );
}
