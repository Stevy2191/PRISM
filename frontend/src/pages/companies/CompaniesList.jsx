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
import SettingsPage from '../../components/settings/SettingsPage';
import { IconSearch } from '@tabler/icons-react';
import PageHeader from '../../components/ui/PageHeader';
import SelectChip from '../../components/ui/SelectChip';
import StatusChip from '../../components/ui/StatusChip';
import Notice from '../../components/ui/Notice';
import Button from '../../components/ui/Button';

export function CompanyFlags({ company }) {
  const flags = [company.isInternal && 'Internal', company.isClient && 'Client', company.isVendor && 'Vendor'].filter(Boolean);
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => <span key={f} className="rounded-full border border-navy-100 px-2 py-px text-xs font-medium text-navy-600">{f}</span>)}
    </span>
  );
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

  const newButton = canManage && <Button variant="primary" onClick={() => setCreating(true)}>+ New company</Button>;
  const body = (
    <>
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative w-full min-w-0 sm:w-72">
            <IconSearch size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
            <input aria-label="Search companies" className="input h-11 pl-9 text-sm lg:h-8 lg:pl-8 lg:text-[13px]" placeholder="Search companies…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <SelectChip label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All kinds</option>
            <option value="client">Clients</option>
            <option value="vendor">Vendors</option>
          </SelectChip>
          <SelectChip label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="">Any status</option>
          </SelectChip>
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
                    <td className="table-td"><Link to={`/companies/${c.id}`} className="font-semibold hover:underline" style={{ color: 'var(--color-accent)' }}>{c.name}</Link></td>
                    <td className="table-td"><CompanyFlags company={c} /></td>
                    <td className="table-td"><StatusChip tone={c.status === 'active' ? 'good' : 'neutral'} className="!text-xs">{c.status === 'active' ? 'Active' : 'Inactive'}</StatusChip></td>
                    <td className="table-td num">{c.contactCount}</td>
                    <td className="table-td num">{c.openTicketCount}</td>
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
    </>
  );
  // In Settings it sits in the Settings frame; on /companies it has its own header.
  if (inSettings) return <SettingsPage title="Companies & vendors" actions={newButton}>{body}</SettingsPage>;
  return (
    <div className="mx-auto max-w-[1144px] space-y-5 lg:px-6">
      <PageHeader title="Companies" sub={loading ? undefined : `${pager.total.toLocaleString()} compan${pager.total === 1 ? 'y' : 'ies'}`} actions={newButton} />
      {body}
    </div>
  );
}
