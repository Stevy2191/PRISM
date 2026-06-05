import { useEffect, useState } from 'react';
import api, { errMessage } from '../api/api';
import Spinner from '../components/Spinner';

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
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/settings')
      .then(({ data }) => setSettings(data.settings))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Settings</h1>
        <p className="text-sm text-navy-500">
          Read-only view of the server configuration (sourced from environment variables).
          Secrets are never displayed.
        </p>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-navy-900">LDAP / Active Directory</h2>
        <Row label="LDAP URL" value={settings.ldap.url} />
        <Row label="Base DN" value={settings.ldap.baseDN} />
        <Row label="Bind DN" value={settings.ldap.bindDN} />
        <Row label="User filter" value={settings.ldap.userFilter} />
        <div className="flex justify-between py-2 text-sm">
          <span className="text-navy-500">Bind password</span>
          <Bool value={settings.ldap.bindPasswordSet} />
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-navy-900">Database</h2>
        <Row label="Host" value={settings.database.host} />
        <Row label="Port" value={settings.database.port} />
        <Row label="Name" value={settings.database.name} />
        <Row label="User" value={settings.database.user} />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-navy-900">Application</h2>
        <Row label="Environment" value={settings.app.nodeEnv} />
        <div className="flex justify-between py-2 text-sm">
          <span className="text-navy-500">Session secret</span>
          <Bool value={settings.app.sessionSecretSet} />
        </div>
      </div>
    </div>
  );
}
