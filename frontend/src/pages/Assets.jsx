import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { usePermission } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import AssetFormModal from '../components/AssetFormModal';

const BORDER = 'var(--color-border)';
const CARD_BG = 'var(--color-card)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BLUE = 'var(--color-accent)';

export const STATUS_META = {
  active: { label: 'Active', color: 'var(--color-success)' },
  in_repair: { label: 'In repair', color: 'var(--color-warning)' },
  retired: { label: 'Retired', color: 'var(--color-text-muted)' },
  in_storage: { label: 'In storage', color: 'var(--color-accent)' },
  lost: { label: 'Lost', color: 'var(--color-danger)' },
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Shared by warranty expiry + replacement plan date: red if past, amber if
// within 90 days, muted otherwise.
export function dateUrgencyColor(dateStr) {
  if (!dateStr) return MUTED;
  const today = todayStr();
  if (dateStr < today) return 'var(--color-danger)';
  const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  if (dateStr <= in90) return 'var(--color-warning)';
  return MUTED;
}

export function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.active;
  return (
    <span
      className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 13%, transparent)`, color: meta.color }}
    >
      {meta.label}
    </span>
  );
}

export function CategoryBadge({ category }) {
  if (!category) return <span className="text-xs" style={{ color: MUTED }}>—</span>;
  return (
    <span
      className="inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${category.color || MUTED} 13%, transparent)`, color: category.color || MUTED }}
    >
      <span>{category.icon}</span>
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
  const [status, setStatus] = useState(() => searchParams.get('status') || '');
  const [assignedTo, setAssignedTo] = useState('');
  const [view, setView] = useState('table');
  // Dashboard drill-down only, not a toolbar control: 'dueForReplacement' /
  // 'expiredWarranty' — no backend query param for these (they're date-math,
  // not a plain equality filter), so applied client-side after the fetch.
  const quickFilter = searchParams.get('filter');

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
    if (status) params.status = status;
    if (assignedTo) params.assignedTo = assignedTo;
    api.get('/assets', { params })
      .then(({ data }) => setAssets(data.assets))
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
  }, [search, categoryId, departmentId, status, assignedTo]);

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

  const filteredAssets = useMemo(() => {
    if (!quickFilter) return assets;
    const today = todayStr();
    const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    if (quickFilter === 'dueForReplacement') return assets.filter((a) => a.replacementPlanDate && a.replacementPlanDate <= in90);
    if (quickFilter === 'expiredWarranty') return assets.filter((a) => a.warrantyExpiryDate && a.warrantyExpiryDate < today);
    return assets;
  }, [assets, quickFilter]);

  return (
    <div style={{ padding: 0, height: '100vh' }} className="-mx-3 -my-4 flex flex-col overflow-hidden bg-navy-50 sm:-mx-6 sm:-my-8">
      <div className="flex-shrink-0 space-y-3 px-3 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold" style={{ color: TEXT }}>Assets</h1>
          {canCreate && (
            <button type="button" onClick={() => setShowForm(true)} className="btn-primary hidden lg:inline-flex">
              + New asset
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by asset tag, name, serial number, make, model…"
            className="input h-9 min-w-[220px] flex-1 text-sm"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
          />
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input h-9 flex-shrink-0 text-sm" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT, maxWidth: '12rem' }}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="input h-9 flex-shrink-0 text-sm" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT, maxWidth: '11rem' }}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input h-9 flex-shrink-0 text-sm" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT, maxWidth: '10rem' }}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="in_repair">In repair</option>
            <option value="retired">Retired</option>
            <option value="in_storage">In storage</option>
            <option value="lost">Lost</option>
          </select>
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="input h-9 flex-shrink-0 text-sm" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT, maxWidth: '9rem' }}>
            <option value="">All</option>
            <option value="assigned">Assigned</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <div className="flex flex-shrink-0 rounded-md border" style={{ borderColor: BORDER }}>
            <button type="button" onClick={() => setView('table')} className="rounded-l-md px-3 py-2 text-sm font-medium" style={{ backgroundColor: view === 'table' ? BLUE : CARD_BG, color: view === 'table' ? 'white' : TEXT }}>Table</button>
            <button type="button" onClick={() => setView('card')} className="rounded-r-md px-3 py-2 text-sm font-medium" style={{ backgroundColor: view === 'card' ? BLUE : CARD_BG, color: view === 'card' ? 'white' : TEXT }}>Card</button>
          </div>
        </div>

        {error && <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      </div>

      <div className="px-3 pb-4 sm:px-6 sm:pb-6" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
        {loading ? (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        ) : filteredAssets.length === 0 ? (
          <div className="rounded-[10px] border p-8 text-center text-sm" style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: MUTED }}>
            No assets found.
          </div>
        ) : view === 'card' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredAssets.map((a) => (
              <Link
                key={a.id}
                to={`/assets/${a.id}`}
                className="block rounded-[10px] border p-4 transition hover:shadow-md"
                style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold" style={{ color: MUTED }}>{a.assetTag}</p>
                    <h2 className="truncate font-semibold" style={{ color: TEXT }}>{a.name}</h2>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
                <div className="mt-2"><CategoryBadge category={a.category} /></div>
                <p className="mt-2 text-sm" style={{ color: MUTED }}>{[a.make, a.model].filter(Boolean).join(' · ') || '—'}</p>
                <p className="mt-1 text-sm" style={{ color: TEXT }}>{assignedToLabel(a) || <span style={{ color: MUTED }}>Unassigned</span>}</p>
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
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
        ) : (
          <div className="overflow-x-auto rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
            <table className="min-w-full">
              <thead>
                <tr>
                  {['Asset tag', 'Name', 'Category', 'Make/Model', 'Assigned to', 'Department', 'Status', 'Warranty expiry', 'Replacement plan', 'Actions'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}`, color: MUTED }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map((a) => (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${BORDER}` }} className="hover:bg-[var(--color-hover)]">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-sm" style={{ color: TEXT }}>
                      <Link to={`/assets/${a.id}`} className="hover:underline">{a.assetTag}</Link>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: TEXT }}>
                      <Link to={`/assets/${a.id}`} className="hover:underline">{a.name}</Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3"><CategoryBadge category={a.category} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: MUTED }}>{[a.make, a.model].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: TEXT }}>{assignedToLabel(a) || <span style={{ color: MUTED }}>Unassigned</span>}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: MUTED }}>{a.department?.name || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: dateUrgencyColor(a.warrantyExpiryDate) }}>{a.warrantyExpiryDate || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: dateUrgencyColor(a.replacementPlanDate) }}>{a.replacementPlanDate || '—'}</td>
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
      </div>

      {canCreate && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full text-2xl font-semibold text-white shadow-lg lg:hidden"
          style={{ backgroundColor: BLUE }}
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
            className="max-h-[100dvh] w-full overflow-y-auto rounded-none bg-white p-5 shadow-lg sm:max-h-[90vh] sm:max-w-md sm:rounded-lg"
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
