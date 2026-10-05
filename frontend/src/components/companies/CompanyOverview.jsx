import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { useCompanySummary } from '../../context/CompanyContext';
import { useToast } from '../../context/ToastContext';

// Overview tab: the company's fields, email domains and account manager.
export default function CompanyOverview({ company, onSaved }) {
  const { hasPermission } = useAuth();
  const { refresh: refreshSummary } = useCompanySummary();
  const { showToast } = useToast();
  const canManage = hasPermission('companies.manage');
  const [form, setForm] = useState({
    name: company.name, isClient: company.isClient, isVendor: company.isVendor, status: company.status,
    phone: company.phone || '', website: company.website || '', notes: company.notes || '',
    accountManagerId: company.accountManagerId || '',
  });
  const [managers, setManagers] = useState([]);
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api.get('/users/assignable').then(({ data }) => setManagers(data.users)).catch(() => {}); }, []);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { data } = await api.patch(`/companies/${company.id}`, {
        ...form, phone: form.phone || null, website: form.website || null, notes: form.notes || null,
        accountManagerId: form.accountManagerId || null,
      });
      onSaved(data.company);
      refreshSummary();
      showToast('Company saved');
    } catch (err) {
      setError(errMessage(err));
    }
  };
  const addDomain = async () => {
    setError('');
    try {
      await api.post(`/companies/${company.id}/domains`, { domain });
      setDomain('');
      const { data } = await api.get(`/companies/${company.id}`);
      onSaved(data.company);
    } catch (err) {
      setError(errMessage(err));
    }
  };
  const removeDomain = async (d) => {
    try {
      await api.delete(`/companies/${company.id}/domains/${d.id}`);
      const { data } = await api.get(`/companies/${company.id}`);
      onSaved(data.company);
    } catch (err) {
      setError(errMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <form onSubmit={save} className="card grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
        <div><label className="label" htmlFor="co-name">Name</label><input id="co-name" className="input" value={form.name} disabled={!canManage} onChange={set('name')} /></div>
        <div>
          <label className="label" htmlFor="co-manager">Account manager</label>
          <select id="co-manager" className="input" value={form.accountManagerId} disabled={!canManage} onChange={set('accountManagerId')}>
            <option value="">None</option>
            {managers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
        </div>
        <div><label className="label" htmlFor="co-phone">Phone</label><input id="co-phone" className="input" value={form.phone} disabled={!canManage} onChange={set('phone')} /></div>
        <div><label className="label" htmlFor="co-website">Website</label><input id="co-website" className="input" value={form.website} disabled={!canManage} onChange={set('website')} /></div>
        <div className="flex items-center gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isClient} disabled={!canManage || company.isInternal} onChange={set('isClient')} /> Client</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isVendor} disabled={!canManage} onChange={set('isVendor')} /> Vendor</label>
        </div>
        <div>
          <label className="label" htmlFor="co-status">Status</label>
          <select id="co-status" className="input" value={form.status} disabled={!canManage || company.isInternal} onChange={set('status')}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="sm:col-span-2"><label className="label" htmlFor="co-notes">Notes</label><textarea id="co-notes" className="input" rows={3} value={form.notes} disabled={!canManage} onChange={set('notes')} /></div>
        {canManage && <div className="sm:col-span-2"><button type="submit" className="btn-primary">Save</button></div>}
      </form>

      <div className="card space-y-3 p-5">
        <p className="eyebrow">Email domains</p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>New contacts emailing from these domains are filed under {company.name}.</p>
        <ul className="space-y-1 text-sm">
          {(company.domains || []).map((d) => (
            <li key={d.id} className="flex items-center gap-3">
              <span className="font-mono">{d.domain}</span>
              {canManage && <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => removeDomain(d)}>Remove</button>}
            </li>
          ))}
          {!(company.domains || []).length && <li style={{ color: 'var(--color-muted)' }}>No domains.</li>}
        </ul>
        {canManage && (
          <div className="flex gap-2">
            <input aria-label="New domain" className="input h-9 text-sm" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
            <button type="button" className="btn-secondary h-9 px-3 text-sm" onClick={addDomain} disabled={!domain.trim()}>Add domain</button>
          </div>
        )}
      </div>
    </div>
  );
}
