import { useEffect, useMemo, useState } from 'react';
import CompanyFilter from '../components/companies/CompanyFilter';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { usePagination } from '../hooks/usePagination';
import Pagination from '../components/Pagination';
import { usePermission } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import AssetFormModal from '../components/AssetFormModal';
import AssetsSubNav from '../components/AssetsSubNav';
import { IconAdjustmentsHorizontal, IconSearch } from '@tabler/icons-react';
import { useFullPageHeight } from '../hooks/useFullPageHeight';
import PageHeader from '../components/ui/PageHeader';
import FiltersSheet from '../components/ui/FiltersSheet';
import SelectChip from '../components/ui/SelectChip';
import Notice from '../components/ui/Notice';
import Button from '../components/ui/Button';
import StatusChip from '../components/ui/StatusChip';
import { orgToday, addDays } from '../utils/orgDate';

const BORDER = 'var(--color-border)';
const CARD_BG = 'var(--color-card)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BLUE = 'var(--color-accent)';

export const STATUS_META = {
  active: { label: 'Active', color: 'var(--color-success)', tone: 'info' },
  in_repair: { label: 'In repair', color: 'var(--color-warning)', tone: 'waiting' },
  retired: { label: 'Retired', color: 'var(--color-text-muted)', tone: 'neutral' },
  in_storage: { label: 'In storage', color: 'var(--color-accent)', tone: 'neutral' },
  lost: { label: 'Lost', color: 'var(--color-danger)', tone: 'bad' },
};


// Shared by warranty expiry + replacement plan date: red if past, amber if
// within 90 days, muted otherwise.
export function dateUrgencyColor(dateStr) {
  if (!dateStr) return MUTED;
  const today = orgToday();
  if (dateStr < today) return 'var(--color-danger)';
  const in90 = addDays(today, 90);
  if (dateStr <= in90) return 'var(--color-warning)';
  return MUTED;
}

export function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.active;
  return <StatusChip tone={meta.tone} className="!text-xs">{meta.label}</StatusChip>;
}

export function CategoryBadge({ category }) {
  if (!category) return <span className="text-xs" style={{ color: MUTED }}>—</span>;
  return (
    <span className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap text-sm" style={{ color: 'var(--color-text-secondary)' }}>
      <span className="h-2 w-2 flex-shrink-0 rounded-sm" style={{ backgroundColor: category.color || MUTED }} />
      {category.icon && <span aria-hidden="true">{category.icon}</span>}
      {category.name}
    </span>
  );
}

function assignedToLabel(asset) {
  if (asset.assignedToContact) return asset.assignedToContact.displayName;
  if (asset.assignedToUser) return asset.assignedToUser.displayName;
  return null;
}

export default function Assets() {
  const canCreate = usePermission('assets.create');
  const canEdit = usePermission('assets.edit');
  const canDelete = usePermission('assets.delete');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [assets, setAssets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [companyId, setCompanyId] = useState(searchParams.get('companyId') || '');
  const [status, setStatus] = useState(() => searchParams.get('status') || '');
  const [assignedTo, setAssignedTo] = useState('');
  const [view, setView] = useState('table');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const pageHeight = useFullPageHeight();
  // Dashboard drill-down only, not a toolbar control: 'dueForReplacement' /
  // 'expiredWarranty'. Passed through to the API as ?quickFilter — it used to
  // be applied here after the fetch, which stopped being correct once the
  // fetch returns one page instead of every asset.
  const quickFilter = searchParams.get('filter');

  const filterKey = JSON.stringify([search, categoryId, departmentId, companyId, status, assignedTo, quickFilter]);
  const pager = usePagination({ filterKey, storageKey: 'prism.assets.pageSize' });

  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteWarning, setDeleteWarning] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    const params = {};
    if (search.trim()) params.search = search.trim();
    if (categoryId) params.categoryId = categoryId;
    if (departmentId) params.departmentId = departmentId;
    if (companyId) params.companyId = companyId;
    if (status) params.status = status;
    if (assignedTo) params.assignedTo = assignedTo;
    if (quickFilter) params.quickFilter = quickFilter;
    api.get('/assets', { params: { ...params, ...pager.params } })
      .then(({ data }) => { setAssets(data.assets); pager.applyMeta(data); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    api.get('/assets/categories').then(({ data }) => setCategories(data.categories)).catch(() => {});
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, categoryId, departmentId, companyId, status, assignedTo, quickFilter, pager.page, pager.limit]);

  const requestDelete = (asset) => {
    setDeleteTarget(asset);
    setDeleteWarning(null);
  };

  const confirmDelete = async (force) => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/assets/${deleteTarget.id}`, { params: force ? { force: 'true' } : {} });
      setDeleteTarget(null);
      setDeleteWarning(null);
      load();
    } catch (err) {
      if (err?.response?.data?.code === 'HAS_LINKED_TICKETS') {
        setDeleteWarning(err.response.data);
      } else {
        alert(errMessage(err));
        setDeleteTarget(null);
      }
    } finally {
      setDeleting(false);
    }
  };

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // The quick filters are resolved in SQL now, so the fetched page is already
  // the filtered set.
  const filteredAssets = assets;

  const activeFilterCount = [categoryId, departmentId, status, assignedTo, companyId].filter(Boolean).length;
  // The four filter selects, as inline chips (desktop) or labelled fields in
  // the phone Filters sheet. Each is named the same either way.
  const filterSelects = (as) => {
    const filters = [
      ['Category', categoryId, setCategoryId, [['', 'All categories'], ...categories.map((c) => [String(c.id), c.name])]],
      ['Department', departmentId, setDepartmentId, [['', 'All departments'], ...departments.map((d) => [String(d.id), d.name])]],
      ['Status', status, setStatus, [['', 'All statuses'], ...Object.entries(STATUS_META).map(([k, m]) => [k, m.label])]],
      ['Assigned to', assignedTo, setAssignedTo, [['', 'All'], ['assigned', 'Assigned'], ['unassigned', 'Unassigned']]],
    ];
    return filters.map(([label, value, set, options]) => {
      const opts = options.map(([v, l]) => <option key={v} value={v}>{l}</option>);
      if (as === 'chip') {
        return <SelectChip key={label} label={label} value={value} onChange={(e) => set(e.target.value)} className="max-lg:hidden">{opts}</SelectChip>;
      }
      const id = `asset-filter-${label.replace(/\s+/g, '-').toLowerCase()}`;
      return (
        <div key={label}>
          <label className="label" htmlFor={id}>{label}</label>
          <select id={id} value={value} onChange={(e) => set(e.target.value)} className="input h-11 text-sm">{opts}</select>
        </div>
      );
    });
  };

  return (
    <div style={{ padding: 0, height: pageHeight }} className="-mx-3 -my-4 flex flex-col overflow-hidden bg-navy-50 sm:-mx-6 sm:-my-8">
      <div className="flex-shrink-0 space-y-4 px-4 pb-4 pt-5 sm:px-6 lg:px-12 lg:pt-8">
        <PageHeader
          title="Assets"
          sub={loading ? undefined : `${pager.total.toLocaleString()} asset${pager.total === 1 ? '' : 's'}`}
          actions={(
            <>
              <div role="group" aria-label="View" className="hidden overflow-hidden rounded-md border border-navy-100 bg-surface md:inline-flex">
                {[['table', 'Table'], ['card', 'Card']].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={view === key}
                    onClick={() => setView(key)}
                    className={`h-10 px-3 text-sm lg:h-8 ${view === key ? 'font-semibold' : 'font-medium text-navy-500 hover:bg-[var(--color-hover)]'}`}
                    style={view === key ? { backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent)' } : undefined}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {canCreate && (
                <Button variant="primary" onClick={() => setShowForm(true)} className="max-lg:hidden">
                  + New asset
                </Button>
              )}
            </>
          )}
        />
        <AssetsSubNav />

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 lg:w-80 lg:flex-none">
            <IconSearch size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by asset tag, name, serial number, make, model…"
              aria-label="Search assets"
              className="input h-11 pl-9 text-sm lg:h-8 lg:pl-8 lg:text-[13px]"
            />
          </label>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="inline-flex h-11 flex-shrink-0 items-center gap-2 rounded-md border border-navy-100 bg-surface px-3 text-sm font-semibold text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent lg:hidden"
          >
            <IconAdjustmentsHorizontal size={16} aria-hidden="true" />
            Filters
            {activeFilterCount > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-xs font-semibold" style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>
                {activeFilterCount}
              </span>
            )}
          </button>
          <span className="contents max-lg:hidden">
            <CompanyFilter value={companyId} onChange={setCompanyId} className="sel" />
          </span>
          {filterSelects('chip')}
        </div>

        {error && <Notice tone="bad">{error}</Notice>}
      </div>

      <FiltersSheet open={filtersOpen} onClose={() => setFiltersOpen(false)}>
        <CompanyFilter value={companyId} onChange={setCompanyId} className="input h-11 text-sm" />
        {filterSelects('sheet')}
      </FiltersSheet>

      <div className="px-4 pb-4 sm:px-6 sm:pb-6 lg:px-12" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
        {loading ? (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        ) : filteredAssets.length === 0 ? (
          <div className="rounded-xl border border-navy-100 bg-surface p-8 text-center text-sm" style={{ color: MUTED }}>
            No assets found.
          </div>
        ) : (
          <>
          <div className={`grid grid-cols-1 gap-3 md:gap-4 ${view === 'card' ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:hidden'}`}>
            {filteredAssets.map((a) => (
              <Link
                key={a.id}
                to={`/assets/${a.id}`}
                className="block min-w-0 rounded-xl border border-navy-100 bg-surface p-4 transition hover:bg-[var(--color-hover)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="num text-xs font-semibold" style={{ color: MUTED }}>{a.assetTag}</p>
                    <h2 className="truncate font-semibold" style={{ color: TEXT }}>{a.name}</h2>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <CategoryBadge category={a.category} />
                  <span style={{ color: assignedToLabel(a) ? TEXT : MUTED }}>{assignedToLabel(a) || 'Unassigned'}</span>
                </div>
                <p className="mt-1 text-sm max-md:hidden" style={{ color: MUTED }}>{[a.make, a.model].filter(Boolean).join(' · ') || '—'}</p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium">
                  {a.warrantyExpiryDate && (
                    <span style={{ color: dateUrgencyColor(a.warrantyExpiryDate) }}>Warranty {a.warrantyExpiryDate}</span>
                  )}
                  {a.replacementPlanDate && (
                    <span style={{ color: dateUrgencyColor(a.replacementPlanDate) }}>Replace {a.replacementPlanDate}</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
          {view === 'table' && (
          <div className="hidden overflow-x-auto rounded-xl border border-navy-100 bg-surface md:block">
            <table className="min-w-full">
              <thead>
                <tr>
                  {['Asset tag', 'Name', 'Category', 'Make/Model', 'Assigned to', 'Department', 'Status', 'Warranty expiry', 'Replacement plan', 'Actions'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold" style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}`, color: MUTED }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map((a) => (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${BORDER}` }} className="hover:bg-[var(--color-hover)]">
                    <td className="num whitespace-nowrap px-4 py-3 text-sm font-semibold">
                      <Link to={`/assets/${a.id}`} className="hover:underline" style={{ color: BLUE }}>{a.assetTag}</Link>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold">
                      <Link to={`/assets/${a.id}`} className="hover:underline" style={{ color: BLUE }}>{a.name}</Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3"><CategoryBadge category={a.category} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: MUTED }}>{[a.make, a.model].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: TEXT }}>{assignedToLabel(a) || <span style={{ color: MUTED }}>Unassigned</span>}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: MUTED }}>{a.department?.name || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="num whitespace-nowrap px-4 py-3 text-sm" style={{ color: dateUrgencyColor(a.warrantyExpiryDate) }}>{a.warrantyExpiryDate || '—'}</td>
                    <td className="num whitespace-nowrap px-4 py-3 text-sm" style={{ color: dateUrgencyColor(a.replacementPlanDate) }}>{a.replacementPlanDate || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <div className="flex items-center gap-3">
                        {canEdit && <Link to={`/assets/${a.id}`} style={{ color: BLUE }}>Edit</Link>}
                        {canDelete && (
                          <button type="button" onClick={() => requestDelete(a)} style={{ color: 'var(--color-danger)' }}>Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          </>
        )}
      </div>

      {!loading && filteredAssets.length > 0 && (
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

      {canCreate && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="fixed bottom-6 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full text-2xl font-semibold shadow-lg lg:hidden"
          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}
          aria-label="New asset"
        >
          +
        </button>
      )}

      {showForm && (
        <AssetFormModal
          categories={categories}
          departments={departments}
          onClose={() => setShowForm(false)}
          onSaved={(asset) => { setShowForm(false); navigate(`/assets/${asset.id}`); }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 sm:p-4" onClick={() => { setDeleteTarget(null); setDeleteWarning(null); }}>
          <div
            className="max-h-[100dvh] w-full overflow-y-auto rounded-none bg-surface p-5 shadow-lg sm:max-h-[90vh] sm:max-w-md sm:rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-base font-semibold text-navy-900">Delete &quot;{deleteTarget.name}&quot;?</h2>
            {deleteWarning ? (
              <p className="mb-4 text-sm text-red-700">{deleteWarning.message}</p>
            ) : (
              <p className="mb-4 text-sm text-navy-600">This cannot be undone.</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setDeleteTarget(null); setDeleteWarning(null); }} className="btn-secondary">Cancel</button>
              <button type="button" onClick={() => confirmDelete(!!deleteWarning)} disabled={deleting} className="btn-danger">
                {deleting ? 'Deleting…' : deleteWarning ? 'Delete anyway' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
