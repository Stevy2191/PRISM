import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useToast } from '../context/ToastContext';
import Spinner from '../components/Spinner';

const EMPTY = { name: '', shortCode: '', description: '', defaultRoleId: '' };

export default function AdminDepartments() {
  const { showToast } = useToast();
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY);

  // Two separate, unambiguous pieces of state instead of one "editing"
  // value that used to double as both a boolean-ish flag and a numeric id
  // (previously set to the *string* 'new' for create mode — since any
  // non-empty string is truthy in JS, `if (editing)` treated create mode
  // the same as edit mode and PATCHed /departments/new instead of POSTing,
  // which 404'd as "Department not found").
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [shortCodeError, setShortCodeError] = useState('');

  const load = () => {
    Promise.all([api.get('/departments'), api.get('/roles')])
      .then(([d, r]) => { setDepartments(d.data.departments); setRoles(r.data.roles); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openCreate = () => {
    setForm(EMPTY);
    setEditingId(null);
    setFormError('');
    setShortCodeError('');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY);
    setFormError('');
    setShortCodeError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const payload = { ...form, defaultRoleId: form.defaultRoleId || null };
    setSaving(true);
    setFormError('');
    setShortCodeError('');
    try {
      if (editingId !== null) {
        await api.patch(`/departments/${editingId}`, payload);
      } else {
        await api.post('/departments', payload);
        showToast('Department created successfully');
      }
      closeForm();
      load(); // refresh the list from the server so the new/updated department appears immediately
    } catch (err) {
      if (err?.response?.data?.code === 'SHORT_CODE_TAKEN') {
        setShortCodeError(errMessage(err));
      } else {
        setFormError(errMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (d) => {
    setEditingId(d.id);
    setForm({
      name: d.name,
      shortCode: d.shortCode || '',
      description: d.description || '',
      defaultRoleId: d.defaultRoleId || '',
    });
    setFormError('');
    setShortCodeError('');
    setShowForm(true);
  };

  const remove = async (d) => {
    const msg = d.memberCount > 0
      ? `${d.name} has ${d.memberCount} user${d.memberCount === 1 ? '' : 's'}. Deleting it will leave them without a department. Are you sure?`
      : `Delete ${d.name}?`;
    if (!confirm(msg)) return;
    try {
      await api.delete(`/departments/${d.id}`);
      setDepartments((ds) => ds.filter((x) => x.id !== d.id));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Departments</h1>
        {!showForm && (
          <button className="btn-primary" onClick={openCreate}>+ New department</button>
        )}
      </div>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {showForm && (
        <form onSubmit={submit} className="card space-y-4 p-5">
          {formError && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Short code <span className="text-red-500">*</span></label>
              <input
                className={`input uppercase ${shortCodeError ? 'border-red-400' : ''}`}
                value={form.shortCode}
                maxLength={6}
                placeholder="e.g. IT, HR, MNT"
                onChange={(e) => { setForm((f) => ({ ...f, shortCode: e.target.value.toUpperCase() })); setShortCodeError(''); }}
                required
              />
              {shortCodeError ? (
                <p className="mt-1 text-xs text-red-600">{shortCodeError}</p>
              ) : (
                <p className="mt-1 text-xs text-navy-400">Up to 6 characters, used to prefix this department's project IDs (e.g. IT-P00001).</p>
              )}
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="label">Default role</label>
            <select
              className="input"
              value={form.defaultRoleId}
              onChange={(e) => setForm((f) => ({ ...f, defaultRoleId: e.target.value }))}
            >
              <option value="">None</option>
              {roles.filter((r) => r.name !== 'Requester').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-navy-400">New users added to this department get this role automatically.</p>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={closeForm}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editingId !== null ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      )}

      <div className="card divide-y divide-navy-100">
        {departments.map((d) => (
          <div key={d.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium text-navy-900">{d.name}</p>
                {d.shortCode ? (
                  <span className="badge bg-navy-100 text-navy-700">{d.shortCode}</span>
                ) : (
                  <span className="badge bg-amber-100 text-amber-800" title="Configure a short code so this department's project IDs use it instead of the generic fallback">
                    No short code — project IDs will use &quot;DEPT&quot; prefix
                  </span>
                )}
              </div>
              {d.description && <p className="text-sm text-navy-500">{d.description}</p>}
              <p className="mt-0.5 text-xs text-navy-400">
                {d.memberCount} member{d.memberCount === 1 ? '' : 's'}
                {d.defaultRole ? ` · Default role: ${d.defaultRole.name}` : ''}
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => startEdit(d)} className="text-xs text-prism hover:underline">edit</button>
              <button onClick={() => remove(d)} className="text-xs text-red-500 hover:underline">delete</button>
            </div>
          </div>
        ))}
        {departments.length === 0 && <p className="px-5 py-4 text-sm text-navy-400">No departments yet.</p>}
      </div>
    </div>
  );
}
