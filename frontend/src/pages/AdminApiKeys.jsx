import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';

export default function AdminApiKeys() {
  const { isAdmin } = useAuth();
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', expiresAt: '' });
  const [newKey, setNewKey] = useState(null); // plaintext, shown once

  const load = () => {
    api
      .get('/apikeys')
      .then(({ data }) => setKeys(data.apiKeys))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      const { data } = await api.post('/apikeys', {
        name: form.name,
        expiresAt: form.expiresAt || null,
      });
      setNewKey(data.key);
      setKeys((k) => [data.apiKey, ...k]);
      setForm({ name: '', expiresAt: '' });
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const revoke = async (id) => {
    if (!confirm('Revoke this API key?')) return;
    try {
      await api.delete(`/apikeys/${id}`);
      setKeys((k) => k.filter((x) => x.id !== id));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <h1 className="text-2xl font-bold text-navy-900">API Keys</h1>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {newKey && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">
            Copy this key now — it will not be shown again.
          </p>
          <code className="mt-2 block break-all rounded bg-surface px-3 py-2 font-mono text-sm text-navy-900">
            {newKey}
          </code>
          <button onClick={() => setNewKey(null)} className="btn-secondary mt-3 text-xs">Dismiss</button>
        </div>
      )}

      <form onSubmit={create} className="card flex flex-wrap items-end gap-3 p-5">
        <div className="flex-1">
          <label className="label">Key name</label>
          <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. CI integration" />
        </div>
        <div>
          <label className="label">Expires (optional)</label>
          <input type="date" className="input" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
        </div>
        <button type="submit" className="btn-primary">Generate</button>
      </form>

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-navy-100">
          <thead className="bg-navy-50">
            <tr>
              <th className="table-th">Name</th>
              <th className="table-th">Prefix</th>
              {isAdmin && <th className="table-th">Owner</th>}
              <th className="table-th">Last used</th>
              <th className="table-th">Expires</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {keys.map((k) => (
              <tr key={k.id} className="hover:bg-navy-50">
                <td className="table-td font-medium">{k.name}</td>
                <td className="table-td font-mono text-navy-500">{k.prefix}…</td>
                {isAdmin && <td className="table-td text-navy-500">{k.user?.displayName || '—'}</td>}
                <td className="table-td text-navy-400">{k.lastUsed ? new Date(k.lastUsed).toLocaleString() : 'never'}</td>
                <td className="table-td text-navy-400">{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : '—'}</td>
                <td className="table-td">
                  <button onClick={() => revoke(k.id)} className="text-xs text-red-500 hover:underline">revoke</button>
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr><td colSpan={6} className="table-td text-navy-400">No API keys.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
