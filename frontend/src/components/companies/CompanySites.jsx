import { useCallback, useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';

// Sites tab: a company's physical locations. Deactivating keeps history.
export default function CompanySites({ company }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('companies.manage');
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState({ name: '', line1: '', city: '', region: '', postalCode: '', country: '' });
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api.get(`/companies/${company.id}/sites`).then(({ data }) => setSites(data.sites)).catch((err) => setError(errMessage(err)));
  }, [company.id]);
  useEffect(load, [load]);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const add = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || null]));
      await api.post(`/companies/${company.id}/sites`, body);
      setForm({ name: '', line1: '', city: '', region: '', postalCode: '', country: '' });
      load();
    } catch (err) {
      setError(errMessage(err));
    }
  };
  const toggle = async (site) => {
    try {
      await api.patch(`/companies/${company.id}/sites/${site.id}`, { status: site.status === 'active' ? 'inactive' : 'active' });
      load();
    } catch (err) {
      setError(errMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <table className="min-w-full text-sm">
        <thead><tr>{['Site', 'Address', 'Status', ''].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
        <tbody>
          {sites.map((s) => (
            <tr key={s.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
              <td className="table-td">{s.name}</td>
              <td className="table-td">{[s.line1, s.city, s.region, s.postalCode, s.country].filter(Boolean).join(', ') || '—'}</td>
              <td className="table-td">{s.status === 'active' ? 'Active' : 'Inactive'}</td>
              <td className="table-td text-right">
                {canManage && <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => toggle(s)}>{s.status === 'active' ? 'Deactivate' : 'Reactivate'}</button>}
              </td>
            </tr>
          ))}
          {!sites.length && <tr><td className="table-td" colSpan={4}>No sites yet.</td></tr>}
        </tbody>
      </table>
      {canManage && (
        <form onSubmit={add} className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <input aria-label="Site name" className="input" placeholder="Site name" value={form.name} onChange={set('name')} />
          <input aria-label="Address line 1" className="input" placeholder="Address" value={form.line1} onChange={set('line1')} />
          <input aria-label="City" className="input" placeholder="City" value={form.city} onChange={set('city')} />
          <input aria-label="Region" className="input" placeholder="State / region" value={form.region} onChange={set('region')} />
          <input aria-label="Postal code" className="input" placeholder="Postal code" value={form.postalCode} onChange={set('postalCode')} />
          <input aria-label="Country" className="input" placeholder="Country" value={form.country} onChange={set('country')} />
          <div className="sm:col-span-3"><button type="submit" className="btn-primary" disabled={!form.name.trim()}>Add site</button></div>
        </form>
      )}
    </div>
  );
}
