import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { useCompanySummary } from '../../context/CompanyContext';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/Pagination';
import Spinner from '../../components/Spinner';
import CompanyFormModal from '../../components/companies/CompanyFormModal';
import MergeCompanyModal from '../../components/companies/MergeCompanyModal';

export function CompanyFlags({ company }) {
  const flags = [company.isInternal && 'Internal', company.isClient && 'Client', company.isVendor && 'Vendor'].filter(Boolean);
  return <span className="flex flex-wrap gap-1">{flags.map((f) => <span key={f} className="badge">{f}</span>)}</span>;
}

// Settings → Companies (always present) and the Companies nav tab (once a
// client exists) share this list; `inSettings` only changes the chrome.
export default function CompaniesList({ inSettings = false }) {
  const { hasPermission } = useAuth();
  const { refresh: refreshSummary } = useCompanySummary();
  const canManage = hasPermission('companies.manage');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [merging, setMerging] = useState(null);
  const pager = usePagination({ filterKey: JSON.stringify([kind, status, search]), storageKey: 'prism.companies.pageSize' });

  const load = useCallback(() => {
    const params = { ...pager.params };
    if (kind) params.kind = kind;
    if (status) params.status = status;
    if (search.trim()) params.search = search.trim();
    api.get('/companies', { params })
      .then(({ data }) => { setCompanies(data.companies); pager.applyMeta(data); setError(''); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, status, search, pager.page, pager.limit]);
  useEffect(() => { load(); }, [load]);

  const changed = () => { load(); refreshSummary(); };

  return (
    <div className="space-y-5">
      {inSettings && <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-navy-900">Companies</h1>
        {canManage && <button type="button" className="btn-primary" onClick={() => setCreating(true)}>+ New company</button>}
      </div>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <input aria-label="Search companies" className="input h-9 flex-1 text-sm" style={{ minWidth: '14rem' }} placeholder="Search companies…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Kind" className="input h-9 text-sm" style={{ maxWidth: '10rem' }} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All kinds</option>
          <option value="client">Clients</option>
          <option value="vendor">Vendors</option>
        </select>
        <select aria-label="Status" className="input h-9 text-sm" style={{ maxWidth: '9rem' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="">Any status</option>
        </select>
      </div>
      {loading ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                {['Name', 'Kind', 'Status', 'Contacts', 'Open tickets', ''].map((h) => <th key={h} className="table-th">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="table-td"><Link to={`/companies/${c.id}`} className="font-semibold hover:underline">{c.name}</Link></td>
                  <td className="table-td"><CompanyFlags company={c} /></td>
                  <td className="table-td">{c.status === 'active' ? 'Active' : 'Inactive'}</td>
                  <td className="table-td font-mono">{c.contactCount}</td>
                  <td className="table-td font-mono">{c.openTicketCount}</td>
                  <td className="table-td text-right">
                    {canManage && !c.isInternal && (
                      <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => setMerging(c)}>Merge into…</button>
                    )}
                  </td>
                </tr>
              ))}
              {!companies.length && <tr><td className="table-td" colSpan={6}>No companies match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={pager.page} limit={pager.limit} total={pager.total} totalPages={pager.totalPages} onPageChange={pager.setPage} onLimitChange={pager.setLimit} />
      {creating && <CompanyFormModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); changed(); }} />}
      {merging && <MergeCompanyModal company={merging} onClose={() => setMerging(null)} onMerged={() => { setMerging(null); changed(); }} />}
    </div>
  );
}
