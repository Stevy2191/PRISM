import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';

const TABS = [
  { key: 'ticket', label: 'Ticket Statuses', endpoint: '/ticket-statuses' },
  { key: 'project', label: 'Project Statuses', endpoint: '/project-statuses' },
];
const BEHAVIOR_OPTIONS = [
  ['open', 'Open'],
  ['closed', 'Closed'],
  ['archived', 'Archived'],
];

export default function Statuses() {
  const [scope, setScope] = useState('ticket');
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const endpoint = TABS.find((t) => t.key === scope).endpoint;

  const load = () => {
    setLoading(true);
    setError('');
    api.get(endpoint)
      .then(({ data }) => { setStatuses(data.statuses); setDirty(false); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchStatus = async (id, changes) => {
    try {
      const { data } = await api.patch(`${endpoint}/${id}`, changes);
      setStatuses((list) => list.map((s) => (s.id === id ? data.status : s)));
    } catch (err) {
      alert(errMessage(err));
      load();
    }
  };

  const renameLocal = (id, name) => {
    setStatuses((list) => list.map((s) => (s.id === id ? { ...s, name } : s)));
  };

  const addStatus = async () => {
    try {
      const { data } = await api.post(endpoint, { name: 'New Status', color: '#3b82f6', behaviorType: 'open' });
      setStatuses((list) => [...list, data.status]);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const onDragStart = (i) => () => setDragIndex(i);
  const onDragOver = (i) => (e) => e.preventDefault();
  const onDrop = (i) => () => {
    if (dragIndex === null || dragIndex === i) return;
    setStatuses((list) => {
      const next = [...list];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(i, 0, moved);
      return next;
    });
    setDragIndex(null);
    setDirty(true);
  };

  const saveOrder = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`${endpoint}/reorder`, { order: statuses.map((s) => s.id) });
      setStatuses(data.statuses);
      setDirty(false);
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      const { data } = await api.delete(`${endpoint}/${deleteTarget.id}`);
      setStatuses((list) => list.filter((s) => s.id !== deleteTarget.id));
      if (data.reassignedCount > 0) {
        alert(`${data.reassignedCount} record(s) using "${deleteTarget.name}" were moved to "${data.reassignedTo}".`);
      }
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(errMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Statuses</h1>
        <p className="text-sm text-navy-500">Define, reorder, and recolor ticket and project statuses. Changes apply immediately across the app.</p>
      </div>

      <div className="flex gap-1 border-b border-navy-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setScope(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              scope === t.key ? 'border-prism text-prism' : 'border-transparent text-navy-500 hover:text-navy-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {loading ? (
        <Spinner />
      ) : (
        <div className="card p-4">
          <ul className="space-y-2">
            {statuses.map((s, i) => (
              <li
                key={s.id}
                draggable
                onDragStart={onDragStart(i)}
                onDragOver={onDragOver(i)}
                onDrop={onDrop(i)}
                className="flex items-center gap-3 rounded-md border border-navy-200 bg-white p-3"
              >
                <span className="cursor-grab select-none text-lg leading-none text-navy-300" title="Drag to reorder">⠿</span>
                <input
                  type="color"
                  value={s.color}
                  onChange={(e) => patchStatus(s.id, { color: e.target.value })}
                  className="h-8 w-8 flex-shrink-0 cursor-pointer rounded border border-navy-200"
                  title="Status color"
                />
                <input
                  value={s.name}
                  onChange={(e) => renameLocal(s.id, e.target.value)}
                  onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== s.name) patchStatus(s.id, { name: e.target.value.trim() }); }}
                  className="input flex-1"
                />
                <select
                  value={s.behaviorType}
                  onChange={(e) => patchStatus(s.id, { behaviorType: e.target.value })}
                  className="input w-32 flex-shrink-0"
                >
                  {BEHAVIOR_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {s.isDefault && (
                  <span className="flex-shrink-0 rounded-full bg-navy-100 px-2 py-0.5 text-xs font-medium text-navy-600">Default</span>
                )}
                <button
                  type="button"
                  onClick={() => setDeleteTarget(s)}
                  disabled={s.isProtected}
                  title={s.isProtected ? 'Protected statuses cannot be deleted' : 'Delete status'}
                  className="flex-shrink-0 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between">
            <button type="button" onClick={addStatus} className="btn-secondary">+ Add status</button>
            <button type="button" onClick={saveOrder} className="btn-primary" disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save order'}
            </button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 sm:p-4" onClick={() => setDeleteTarget(null)}>
          <div className="max-h-[100dvh] w-full overflow-y-auto rounded-none bg-white p-5 shadow-lg sm:max-h-[90vh] sm:max-w-md sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-base font-semibold text-navy-900">Delete "{deleteTarget.name}"?</h2>
            <p className="mb-4 text-sm text-navy-600">
              Any {scope === 'ticket' ? 'tickets' : 'projects'} currently using this status will be moved to the default
              open status before it's removed.
            </p>
            {deleteError && <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{deleteError}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)} className="btn-secondary">Cancel</button>
              <button type="button" onClick={confirmDelete} disabled={deleting} className="btn-danger">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
