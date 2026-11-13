import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import AssetFormModal from '../AssetFormModal';
import Notice from '../ui/Notice';
import { fmtDate, fmtDateTime } from '../../utils/formatDate';

const MUTED = 'var(--color-text-muted)';
const TEXT = 'var(--color-text-primary)';

// Choose one of the company's assets that nobody has, and check it out to
// this contact (owner, 2026-11-13: from the list that's already there, not
// only by creating a new one).
function AssignExisting({ contact, onClose, onAssigned }) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api.get('/assets', { params: { companyId: contact.companyId, assignedTo: 'unassigned', search: search.trim() || undefined, limit: 25 } })
        .then(({ data }) => setRows(data.assets))
        .catch((err) => setError(errMessage(err)));
    }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, contact.companyId]);
  const assign = async (asset) => {
    setError('');
    setBusy(asset.id);
    try {
      await api.post(`/assets/${asset.id}/checkouts`, { contactId: contact.id });
      onAssigned();
    } catch (err) {
      setError(errMessage(err));
      setBusy(null);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="assign-title">
      <div className="w-full max-w-xl rounded-xl border border-navy-100 bg-surface shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-navy-100 px-5 py-4">
          <h2 id="assign-title" className="text-[15px] font-semibold text-navy-900">Assign an asset to {contact.displayName}</h2>
          <button type="button" onClick={onClose} className="text-sm" style={{ color: MUTED }} aria-label="Close">✕</button>
        </div>
        <div className="space-y-3 p-5">
          {error && <Notice tone="bad">{error}</Notice>}
          <input
            autoFocus
            aria-label="Search assets"
            className="input"
            placeholder="Search by name, tag, serial number, make or model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <p className="text-xs" style={{ color: MUTED }}>Assets that nobody has. One that someone else holds is checked in from its own page first.</p>
          <ul className="max-h-80 divide-y divide-navy-100 overflow-y-auto rounded-lg border border-navy-100 text-sm" data-testid="assignable-assets">
            {(rows || []).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium" style={{ color: TEXT }}>{a.name} <span className="num text-xs font-normal" style={{ color: MUTED }}>{a.assetTag}</span></p>
                  <p className="truncate text-xs" style={{ color: MUTED }}>{[a.category?.name, [a.make, a.model].filter(Boolean).join(' '), a.serialNumber].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <button type="button" className="btn-primary h-8 flex-shrink-0 px-3 text-xs" disabled={busy !== null} onClick={() => assign(a)}>
                  {busy === a.id ? 'Assigning…' : 'Assign'}
                </button>
              </li>
            ))}
            {rows && !rows.length && <li className="px-3 py-4" style={{ color: MUTED }}>{search.trim() ? 'No unassigned asset matches.' : 'Every asset of this company is assigned to someone.'}</li>}
            {!rows && !error && <li className="px-3 py-4" style={{ color: MUTED }}>Loading…</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

// The Assets tab of a contact: everything assigned to them, with the ways
// to give them one more and to take one back.
export default function ContactAssets({ contact, assets, departments, onChanged }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('assets.edit');
  const canCreate = hasPermission('assets.create');
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    if (creating && !categories.length) api.get('/assets/categories').then(({ data }) => setCategories(data.categories)).catch(() => {});
  }, [creating, categories.length]);

  const takeBack = async (a) => {
    setError('');
    setBusy(a.id);
    try {
      if (a.checkout) await api.post(`/assets/${a.id}/checkouts/${a.checkout.id}/check-in`, {});
      else await api.patch(`/assets/${a.id}`, { assignedToContactId: null });
      await onChanged();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm" style={{ color: MUTED }}>
          {assets.length ? `${assets.length} ${assets.length === 1 ? 'asset is' : 'assets are'} assigned to ${contact.displayName}.` : `Nothing is assigned to ${contact.displayName} yet.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {canEdit && <button type="button" className="btn-primary" onClick={() => setPicking(true)}>Assign an existing asset</button>}
          {canCreate && <button type="button" className="btn-secondary" onClick={() => setCreating(true)}>New asset</button>}
        </div>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="overflow-x-auto rounded-xl border border-navy-100 bg-surface">
        <table className="min-w-full" data-testid="contact-assets">
          <thead>
            <tr>
              {['Asset', 'Category', 'Serial number', 'Since', 'Agent', ''].map((h) => (
                <th key={h || 'actions'} className="px-4 py-2 text-left text-xs font-semibold" style={{ color: MUTED, borderBottom: '1px solid var(--color-border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="px-4 py-2.5 text-sm">
                  <Link to={`/assets/${a.id}`} className="font-medium hover:underline" style={{ color: TEXT }}>{a.name}</Link>
                  <span className="num ml-2 text-xs" style={{ color: MUTED }}>{a.assetTag}</span>
                  {(a.makeModel || a.operatingSystem) && <span className="block text-xs" style={{ color: MUTED }}>{[a.makeModel, a.operatingSystem].filter(Boolean).join(' · ')}</span>}
                </td>
                <td className="px-4 py-2.5 text-sm" style={{ color: TEXT }}>{a.category || '—'}</td>
                <td className="num px-4 py-2.5 text-sm" style={{ color: TEXT }}>{a.serialNumber || '—'}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-sm" style={{ color: MUTED }}>{a.checkout ? `Checked out ${fmtDate(a.checkout.checkedOutAt)}` : 'Assigned'}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs" style={{ color: MUTED }}>
                  {a.agent ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a.agent.online ? 'var(--color-success)' : MUTED }} />
                      {a.agent.online ? 'Online' : `Last seen ${a.agent.lastSeenAt ? fmtDateTime(a.agent.lastSeenAt) : 'never'}`}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {canEdit && (
                    <button type="button" className="text-xs font-semibold hover:underline disabled:opacity-60" style={{ color: 'var(--color-accent)' }} disabled={busy === a.id} onClick={() => takeBack(a)}>
                      {busy === a.id ? 'Working…' : (a.checkout ? 'Check in' : 'Unassign')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!assets.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm" style={{ color: MUTED }}>No assets.</td></tr>}
          </tbody>
        </table>
      </div>
      {picking && <AssignExisting contact={contact} onClose={() => setPicking(false)} onAssigned={async () => { setPicking(false); await onChanged(); }} />}
      {creating && (
        <AssetFormModal
          categories={categories}
          departments={departments}
          initial={{ contact, companyId: contact.companyId, departmentId: contact.departmentId }}
          onClose={() => setCreating(false)}
          onSaved={async () => { setCreating(false); await onChanged(); }}
        />
      )}
    </div>
  );
}
