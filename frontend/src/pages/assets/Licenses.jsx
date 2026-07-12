import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { usePermission } from '../../context/AuthContext';
import Spinner from '../../components/Spinner';
import AssetsSubNav from '../../components/AssetsSubNav';
import LicenseFormModal from '../../components/LicenseFormModal';

const BORDER = 'var(--color-border)';
const CARD_BG = 'var(--color-card)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';

export const LICENSE_TYPE_LABELS = {
  per_seat: 'Per seat',
  per_device: 'Per device',
  site_license: 'Site license',
  concurrent: 'Concurrent',
  subscription: 'Subscription',
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function licenseStatus(expiryDate) {
  if (!expiryDate) return { label: 'Active', color: 'var(--color-success)' };
  const today = todayStr();
  if (expiryDate < today) return { label: 'Expired', color: 'var(--color-danger)' };
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  if (expiryDate <= in30) return { label: 'Expiring soon', color: 'var(--color-warning)' };
  return { label: 'Active', color: 'var(--color-success)' };
}

export function LicenseTypeBadge({ type }) {
  return (
    <span
      className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 13%, transparent)', color: 'var(--color-accent)' }}
    >
      {LICENSE_TYPE_LABELS[type] || type}
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

export default function Licenses() {
  const canManage = usePermission('assets.manage_licenses');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [licenses, setLicenses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [licenseType, setLicenseType] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState(() => searchParams.get('status') || '');

  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    const params = {};
    if (search.trim()) params.search = search.trim();
    if (licenseType) params.licenseType = licenseType;
    if (departmentId) params.departmentId = departmentId;
    if (status) params.status = status;
    api.get('/licenses', { params })
      .then(({ data }) => setLicenses(data.licenses))
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
  }, [search, licenseType, departmentId, status]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/licenses/${deleteTarget.id}`);
      setDeleteTarget(null);
      load();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={{ padding: 0, height: '100vh' }} className="-mx-3 -my-4 flex flex-col overflow-hidden bg-navy-50 sm:-mx-6 sm:-my-8">
      <AssetsSubNav />
      <div className="flex-shrink-0 space-y-3 px-3 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold" style={{ color: TEXT }}>Licenses</h1>
          {canManage && (
            <button type="button" onClick={() => setShowForm(true)} className="btn-primary">+ New license</button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or vendor…"
            className="input h-9 min-w-[220px] flex-1 text-sm"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
          />
          <select value={licenseType} onChange={(e) => setLicenseType(e.target.value)} className="input h-9 flex-shrink-0 text-sm" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT, maxWidth: '12rem' }}>
            <option value="">All types</option>
            {Object.entries(LICENSE_TYPE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="input h-9 flex-shrink-0 text-sm" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT, maxWidth: '11rem' }}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input h-9 flex-shrink-0 text-sm" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT, maxWidth: '11rem' }}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="expiring_soon">Expiring soon</option>
            <option value="expired">Expired</option>
          </select>
        </div>

        {error && <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      </div>

      <div className="px-3 pb-4 sm:px-6 sm:pb-6" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
        {loading ? (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        ) : licenses.length === 0 ? (
          <div className="rounded-[10px] border p-8 text-center text-sm" style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: MUTED }}>
            No licenses found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
            <table className="min-w-full">
              <thead>
                <tr>
                  {['Name', 'Vendor', 'Type', 'Seats', 'Department', 'Expiry date', 'Annual cost', 'Auto-renews', 'Actions'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}`, color: MUTED }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {licenses.map((l) => {
                  const status2 = licenseStatus(l.expiryDate);
                  return (
                    <tr key={l.id} style={{ borderBottom: `1px solid ${BORDER}` }} className="hover:bg-[var(--color-hover)]">
                      <td className="px-4 py-3 text-sm" style={{ color: TEXT }}>
                        <Link to={`/assets/licenses/${l.id}`} className="hover:underline">{l.name}</Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: MUTED }}>{l.vendor || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3"><LicenseTypeBadge type={l.licenseType} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: TEXT }}>
                        {l.licenseType === 'site_license' ? 'Unlimited' : `${l.usedSeats}/${l.totalSeats ?? '—'}`}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: MUTED }}>{l.department?.name || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3"><StatusPill status={status2} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: TEXT }}>{l.annualCost ? `$${Number(l.annualCost).toLocaleString()}` : '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: MUTED }}>{l.autoRenews ? 'Yes' : 'No'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <div className="flex items-center gap-3">
                          {canManage && <Link to={`/assets/licenses/${l.id}`} style={{ color: 'var(--color-accent)' }}>Edit</Link>}
                          {canManage && (
                            <button type="button" onClick={() => setDeleteTarget(l)} style={{ color: 'var(--color-danger)' }}>Delete</button>
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

      {showForm && (
        <LicenseFormModal
          departments={departments}
          onClose={() => setShowForm(false)}
          onSaved={(license) => { setShowForm(false); navigate(`/assets/licenses/${license.id}`); }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 sm:p-4" onClick={() => setDeleteTarget(null)}>
          <div className="max-h-[100dvh] w-full overflow-y-auto rounded-none bg-white p-5 shadow-lg sm:max-h-[90vh] sm:max-w-md sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
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
