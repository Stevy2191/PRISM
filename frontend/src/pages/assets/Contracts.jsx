import { useEffect, useState } from 'react';
import CompanyFilter from '../../components/companies/CompanyFilter';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/Pagination';
import { usePermission } from '../../context/AuthContext';
import Spinner from '../../components/Spinner';
import AssetsSubNav from '../../components/AssetsSubNav';
import { IconSearch } from '@tabler/icons-react';
import { useFullPageHeight } from '../../hooks/useFullPageHeight';
import PageHeader from '../../components/ui/PageHeader';
import SelectChip from '../../components/ui/SelectChip';
import Notice from '../../components/ui/Notice';
import Button from '../../components/ui/Button';
import ContractFormModal from '../../components/ContractFormModal';
import { orgToday, addDays } from '../../utils/orgDate';

const BORDER = 'var(--color-border)';
const CARD_BG = 'var(--color-card)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';

export const CONTRACT_TYPE_LABELS = {
  support: 'Support',
  maintenance: 'Maintenance',
  saas: 'SaaS',
  lease: 'Lease',
  subscription: 'Subscription',
  warranty: 'Warranty',
  other: 'Other',
};

export function contractRenewsOn(contract) {
  return contract.renewalDate || contract.endDate || null;
}

export function contractStatus(contract) {
  const renewsOn = contractRenewsOn(contract);
  if (!renewsOn) return { label: 'Active', color: 'var(--color-success)' };
  const today = orgToday();
  if (renewsOn < today) return { label: 'Expired', color: 'var(--color-danger)' };
  const in60 = addDays(today, 60);
  if (renewsOn <= in60) return { label: 'Expiring soon', color: 'var(--color-warning)' };
  return { label: 'Active', color: 'var(--color-success)' };
}

export function ContractTypeBadge({ type }) {
  return (
    <span
      className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: 'color-mix(in srgb, #0f766e 13%, transparent)', color: '#0f766e' }}
    >
      {CONTRACT_TYPE_LABELS[type] || type}
    </span>
  );
}

export function StatusPill({ status }) {
  return (
    <span
      className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${status.color} 13%, transparent)`, color: status.color }}
    >
      {status.label}
    </span>
  );
}

export default function Contracts() {
  const canManage = usePermission('assets.manage_contracts');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [contracts, setContracts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [contractType, setContractType] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [companyId, setCompanyId] = useState(searchParams.get('companyId') || '');
  const [status, setStatus] = useState(() => searchParams.get('status') || '');

  const filterKey = JSON.stringify([search, contractType, departmentId, companyId, status]);
  const pager = usePagination({ filterKey, storageKey: 'prism.contracts.pageSize' });

  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const pageHeight = useFullPageHeight();

  const load = () => {
    setLoading(true);
    const params = {};
    if (search.trim()) params.search = search.trim();
    if (contractType) params.contractType = contractType;
    if (departmentId) params.departmentId = departmentId;
    if (companyId) params.companyId = companyId;
    if (status) params.status = status;
    api.get('/contracts', { params: { ...params, ...pager.params } })
      .then(({ data }) => { setContracts(data.contracts); pager.applyMeta(data); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, contractType, departmentId, companyId, status, pager.page, pager.limit]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/contracts/${deleteTarget.id}`);
      setDeleteTarget(null);
      load();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={{ padding: 0, height: pageHeight }} className="-mx-4 -my-4 flex flex-col overflow-hidden bg-navy-50 sm:-mx-6 sm:-my-8">
      <div className="flex-shrink-0 space-y-4 px-4 pb-4 pt-5 sm:px-6 lg:px-12 lg:pt-8">
        <PageHeader
          title="Contracts"
          sub={loading ? undefined : `${pager.total.toLocaleString()} contract${pager.total === 1 ? '' : 's'}`}
          actions={canManage && (
            <Button variant="primary" onClick={() => setShowForm(true)}>+ New contract</Button>
          )}
        />
        <AssetsSubNav />

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative w-full min-w-0 sm:w-80">
            <IconSearch size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or vendor…"
              aria-label="Search contracts"
              className="input h-11 pl-9 text-sm lg:h-8 lg:pl-8 lg:text-[13px]"
            />
          </label>
          <SelectChip label="Type" value={contractType} onChange={(e) => setContractType(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(CONTRACT_TYPE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </SelectChip>
          <SelectChip label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </SelectChip>
          <CompanyFilter value={companyId} onChange={setCompanyId} className="sel" />
          <SelectChip label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="expiring_soon">Expiring soon</option>
            <option value="expired">Expired</option>
          </SelectChip>
        </div>

        {error && <Notice tone="bad">{error}</Notice>}
      </div>

      <div className="px-4 pb-4 sm:px-6 sm:pb-6 lg:px-12" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
        {loading ? (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        ) : contracts.length === 0 ? (
          <div className="rounded-xl border border-navy-100 bg-surface p-8 text-center text-sm" style={{ color: MUTED }}>
            No contracts found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-navy-100 bg-surface">
            <table className="min-w-full">
              <thead>
                <tr>
                  {['Name', 'Vendor', 'Type', 'Department', 'Start date', 'Renews/ends', 'Annual cost', 'Auto-renews', 'Assets covered', 'Actions'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold" style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}`, color: MUTED }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => {
                  const status2 = contractStatus(c);
                  return (
                    <tr key={c.id} style={{ borderBottom: `1px solid ${BORDER}` }} className="hover:bg-[var(--color-hover)]">
                      <td className="px-4 py-3 text-sm" style={{ color: TEXT }}>
                        <Link to={`/assets/contracts/${c.id}`} className="font-semibold hover:underline" style={{ color: 'var(--color-accent)' }}>{c.name}</Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: MUTED }}>{c.vendor || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3"><ContractTypeBadge type={c.contractType} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: MUTED }}>{c.department?.name || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: MUTED }}>{c.startDate || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3"><StatusPill status={status2} /> <span className="ml-1 text-sm" style={{ color: MUTED }}>{contractRenewsOn(c) || ''}</span></td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: TEXT }}>{c.annualCost ? `$${Number(c.annualCost).toLocaleString()}` : '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: MUTED }}>{c.autoRenews ? 'Yes' : 'No'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: TEXT }}>{c.assetsCoveredCount ?? 0}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <div className="flex items-center gap-3">
                          {canManage && <Link to={`/assets/contracts/${c.id}`} style={{ color: 'var(--color-accent)' }}>Edit</Link>}
                          {canManage && (
                            <button type="button" onClick={() => setDeleteTarget(c)} style={{ color: 'var(--color-danger)' }}>Delete</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && contracts.length > 0 && (
        <div style={{ backgroundColor: CARD_BG, flex: '0 0 auto' }}>
          <Pagination
            page={pager.page}
            limit={pager.limit}
            total={pager.total}
            totalPages={pager.totalPages}
            onPageChange={pager.setPage}
            onLimitChange={pager.setLimit}
          />
        </div>
      )}

      {showForm && (
        <ContractFormModal
          departments={departments}
          onClose={() => setShowForm(false)}
          onSaved={(contract) => { setShowForm(false); navigate(`/assets/contracts/${contract.id}`); }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 sm:p-4" onClick={() => setDeleteTarget(null)}>
          <div className="max-h-[100dvh] w-full overflow-y-auto rounded-none bg-surface p-5 shadow-lg sm:max-h-[90vh] sm:max-w-md sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-base font-semibold text-navy-900">Delete &quot;{deleteTarget.name}&quot;?</h2>
            <p className="mb-4 text-sm text-navy-600">This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)} className="btn-secondary">Cancel</button>
              <button type="button" onClick={confirmDelete} disabled={deleting} className="btn-danger">{deleting ? 'Deleting…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
