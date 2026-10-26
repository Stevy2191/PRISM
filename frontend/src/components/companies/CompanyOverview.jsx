import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { useCompanySummary } from '../../context/CompanyContext';
import { useToast } from '../../context/ToastContext';
import Notice from '../ui/Notice';

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
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="card min-w-0">
      <h2 className="panel-header text-[15px] font-semibold text-navy-900">Details</h2>
      <form onSubmit={save} className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
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
        {/* Set in Settings → SLAs (system settings permission), not here. */}
        <div>
          <p className="label">SLA policy</p>
          <p className="py-2 text-sm text-navy-700" data-testid="company-sla-policy">{company.slaPolicy ? company.slaPolicy.name : 'Default policy'}</p>
        </div>
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
      </section>

      <section className="card min-w-0">
        <h2 className="panel-header text-[15px] font-semibold text-navy-900">Email domains</h2>
        <p className="px-5 pt-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>New contacts emailing from these domains are filed under {company.name}.</p>
        <ul className="divide-y divide-navy-100 text-sm">
          {(company.domains || []).map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <span className="num min-w-0 break-all text-navy-900">{d.domain}</span>
              {canManage && <button type="button" className="text-xs font-semibold hover:underline" style={{ color: 'var(--color-danger)' }} onClick={() => removeDomain(d)}>Remove</button>}
            </li>
          ))}
          {!(company.domains || []).length && <li className="px-5 py-3" style={{ color: 'var(--color-text-muted)' }}>No domains.</li>}
        </ul>
        {canManage && (
          <div className="flex gap-2 border-t border-navy-100 p-4">
            <input aria-label="New domain" className="input h-9 min-w-0 text-sm" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
            <button type="button" className="btn-secondary h-9 flex-shrink-0 px-3 text-sm" onClick={addDomain} disabled={!domain.trim()}>Add domain</button>
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
