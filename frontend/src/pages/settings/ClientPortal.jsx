import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Switch from '../../components/Switch';
import SettingsPage from '../../components/settings/SettingsPage';
import Notice from '../../components/ui/Notice';

// Mockup SettingsPortal: the portal switch and its address. (The Microsoft
// 365 app registration joins this page in 7b.) The switch saves at once.
export default function ClientPortal() {
  const [enabled, setEnabled] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const address = `${window.location.origin}/portal`;

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => setEnabled(data.settings['portal.enabled'] === 'true'))
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
      <section aria-label="Who can manage portal access" className="card p-5">
        <p className="font-medium text-navy-900">Who can manage portal access</p>
        <p className="mt-1 text-sm text-navy-500">
          Granting access, sending invites, and setting admins and contact watchers need the &ldquo;Manage portal access&rdquo; permission:
          administrators, and anyone whose role includes it. Set that in <Link to="/admin/roles" className="font-medium hover:underline" style={{ color: 'var(--color-accent)' }}>Roles &amp; permissions</Link>.
        </p>
      </section>
    </SettingsPage>
  );
}
